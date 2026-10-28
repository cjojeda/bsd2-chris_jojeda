"""Administrator-only file boundaries for the local web application.

The HTTP layer never accepts filesystem paths. Uploads are bounded, decoded to
temporary files, and passed through the same tested migration/backup engine as
local operations. A read-only mobile session cannot use any of these routes.
"""
from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import shutil
import tempfile
import time
from typing import Literal
from uuid import uuid4
import zipfile

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, ConfigDict, Field
from starlette.background import BackgroundTask
from openpyxl.utils.exceptions import InvalidFileException

from .db import SCHEMA_VERSION, TABLES
from .transfer import (
    BACKUP_VERSION, MAX_BACKUP_BYTES, MAX_IMPORT_BYTES, SALE_COLUMNS, VARIANT_COLUMNS,
    ImportPreview, apply_import, export_json, export_sqlite, export_table, make_backup,
    preview_import, read_import_file, restore_json, validate_backup, _load_backup,
    _atomic_file,
)


PLAN_TTL_SECONDS = 30 * 60
MAX_PLANS = 10
MAX_TOTAL_PLAN_BYTES = 40 * 1024 * 1024
MAX_BASE64_LENGTH = ((MAX_IMPORT_BYTES + 2) // 3) * 4


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class BackupInput(Input):
    content: str = Field(min_length=2, max_length=MAX_BACKUP_BYTES)


class RestoreInput(BackupInput):
    confirmed: bool = False


class FileInput(Input):
    fileName: str = Field(min_length=1, max_length=200)
    contentBase64: str = Field(min_length=4, max_length=MAX_BASE64_LENGTH)


class PreviewInput(FileInput):
    kind: Literal["variants", "sales"]
    mapping: dict[str, str] = Field(default_factory=dict, max_length=40)
    sourceAccount: str = Field(default="principal", min_length=1, max_length=160)


class ApplyInput(Input):
    previewId: str = Field(min_length=1, max_length=80)
    acknowledgeWarnings: bool = False


class ClearDemoInput(Input):
    confirmation: str = Field(min_length=1, max_length=80)


@dataclass
class PreviewPlan:
    preview: ImportPreview
    created: float
    size_bytes: int
    result: dict | None = None


def _plans(request: Request) -> dict[str, PreviewPlan]:
    if not hasattr(request.app.state, "transfer_plans"):
        request.app.state.transfer_plans = {}
    plans = request.app.state.transfer_plans
    now = time.monotonic()
    for identifier in list(plans):
        if now - plans[identifier].created > PLAN_TTL_SECONDS:
            del plans[identifier]
    return plans


def _upload(body: FileInput) -> tuple[Path, Path, int]:
    suffix = Path(body.fileName).suffix.casefold()
    if suffix not in (".csv", ".xlsx") or "\x00" in body.fileName:
        raise HTTPException(400, "Seleccioná un archivo .csv o .xlsx.")
    try:
        decoded = base64.b64decode(body.contentBase64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(400, "El archivo codificado no es válido.") from None
    if not decoded or len(decoded) > MAX_IMPORT_BYTES:
        raise HTTPException(400, "El archivo está vacío o supera el límite de 10 MB.")
    if suffix == ".csv" and b"\x00" in decoded:
        raise HTTPException(400, "El CSV contiene datos binarios. Exportalo como texto UTF-8.")
    folder = Path(tempfile.mkdtemp(prefix="sadi-upload-"))
    path = folder / ("upload" + suffix)
    try:
        path.write_bytes(decoded)
    except BaseException:
        shutil.rmtree(folder, ignore_errors=True)
        raise
    return folder, path, len(decoded)


def _json_upload(content: str) -> tuple[Path, Path]:
    data = content.encode("utf-8")
    if len(data) > MAX_BACKUP_BYTES:
        raise HTTPException(400, "El respaldo supera el límite de 50 MB.")
    folder = Path(tempfile.mkdtemp(prefix="sadi-restore-"))
    path = folder / "backup.json"
    try:
        path.write_bytes(data)
    except BaseException:
        shutil.rmtree(folder, ignore_errors=True)
        raise
    return folder, path


def _download(folder: Path, path: Path, filename: str, media_type: str) -> FileResponse:
    return FileResponse(path, filename=filename, media_type=media_type,
                        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
                        background=BackgroundTask(shutil.rmtree, folder, ignore_errors=True))


def _validate_headers(headers):
    if len(headers) > 200:
        raise ValueError("El archivo tiene más de 200 columnas. Exportá únicamente las columnas necesarias.")


def _parse_file(operation, *args):
    """Treat malformed Excel containers/XML as user input, never server faults."""
    try:
        return operation(*args)
    except (zipfile.BadZipFile, zipfile.LargeZipFile, InvalidFileException, KeyError, IndexError, SyntaxError):
        # Parser internals may contain local paths or parts of an uploaded file.
        # Keep those out of the response; domain ValueError messages pass through.
        raise HTTPException(400, "El archivo Excel está dañado o no contiene un libro .xlsx válido. Volvé a exportarlo.") from None


def _preview_response(identifier: str, preview: ImportPreview):
    return {
        "previewId": identifier,
        "headers": preview.headers,
        "rows": preview.raw_rows[:5],
        "rowCount": len(preview.raw_rows),
        "errors": preview.errors,
        "warnings": preview.warnings,
        "documentCount": len(preview.records),
        "ready": preview.ready,
        "expiresInSeconds": PLAN_TTL_SECONDS,
    }


def build_transfer_router(require_admin) -> APIRouter:
    router = APIRouter(prefix="/api", dependencies=[Depends(require_admin)])

    @router.get("/backup")
    async def backup(request: Request):
        folder = Path(tempfile.mkdtemp(prefix="sadi-backup-"))
        stamp = datetime.now().strftime("%Y-%m-%d-%H%M%S")
        try:
            path = export_json(request.app.state.db, folder / "backup.json")
            return _download(folder, path, f"sou-linda-backup-{stamp}.json", "application/json")
        except BaseException:
            shutil.rmtree(folder, ignore_errors=True)
            raise

    @router.get("/backup/sqlite")
    async def sqlite_backup(request: Request):
        folder = Path(tempfile.mkdtemp(prefix="sadi-sqlite-"))
        stamp = datetime.now().strftime("%Y-%m-%d-%H%M%S")
        try:
            path = export_sqlite(request.app.state.db, folder / "backup.sqlite3")
            return _download(folder, path, f"sou-linda-base-{stamp}.sqlite3", "application/vnd.sqlite3")
        except BaseException:
            shutil.rmtree(folder, ignore_errors=True)
            raise

    @router.post("/backup/validate")
    async def validate(request: Request, body: BackupInput):
        folder, path = _json_upload(body.content)
        try:
            document = _load_backup(path)
            tables = validate_backup(document)
            return {"counts": {name: len(tables[name]) for name in TABLES}, "schemaVersion": SCHEMA_VERSION,
                    "formatVersion": BACKUP_VERSION}
        finally:
            shutil.rmtree(folder, ignore_errors=True)

    @router.post("/backup/restore")
    async def restore(request: Request, body: RestoreInput):
        if body.confirmed is not True:
            raise HTTPException(400, "Confirmá explícitamente el reemplazo de la base actual.")
        folder, path = _json_upload(body.content)
        try:
            result = restore_json(request.app.state.db, path)
            _plans(request).clear()
            return {"counts": result["counts"], "previousBackup": result["previous_backup"]}
        finally:
            shutil.rmtree(folder, ignore_errors=True)

    @router.post("/imports/inspect")
    async def inspect(request: Request, body: FileInput):
        folder, path, _ = _upload(body)
        try:
            headers, rows = _parse_file(read_import_file, path)
            _validate_headers(headers)
            return {"headers": headers, "firstRows": rows[:5], "rowCount": len(rows)}
        finally:
            shutil.rmtree(folder, ignore_errors=True)

    @router.post("/imports/preview")
    async def preview(request: Request, body: PreviewInput):
        folder, path, size = _upload(body)
        try:
            plan = _parse_file(preview_import, request.app.state.service, path, body.kind, body.mapping or None, body.sourceAccount)
            _validate_headers(plan.headers)
            plans = _plans(request)
            while plans and (len(plans) >= MAX_PLANS or sum(item.size_bytes for item in plans.values()) + size > MAX_TOTAL_PLAN_BYTES):
                oldest = min(plans, key=lambda key: plans[key].created)
                del plans[oldest]
            identifier = str(uuid4())
            plans[identifier] = PreviewPlan(plan, time.monotonic(), size)
            return _preview_response(identifier, plan)
        finally:
            shutil.rmtree(folder, ignore_errors=True)

    @router.post("/imports/apply")
    async def apply(request: Request, body: ApplyInput):
        plans = _plans(request)
        plan = plans.get(body.previewId)
        if plan is None:
            raise HTTPException(410, "La vista previa venció. Volvé a seleccionar el archivo.")
        if plan.result is not None:
            return plan.result
        result = apply_import(request.app.state.service, plan.preview, body.acknowledgeWarnings)
        plan.result = result
        return result

    @router.get("/exports")
    async def export(request: Request, kind: Literal["variants", "sales", "expenses"], format: Literal["csv", "xlsx"]):
        folder = Path(tempfile.mkdtemp(prefix="sadi-export-"))
        try:
            path = export_table(request.app.state.service, folder / f"export.{format}", kind)
            media = "text/csv; charset=utf-8" if format == "csv" else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            return _download(folder, path, f"sou-linda-{kind}.{format}", media)
        except BaseException:
            shutil.rmtree(folder, ignore_errors=True)
            raise

    @router.get("/templates/{kind}")
    async def template(kind: Literal["variants", "sales"]):
        columns = VARIANT_COLUMNS if kind == "variants" else SALE_COLUMNS
        return Response("\ufeff" + ";".join(columns) + "\r\n", media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="plantilla-{kind}.csv"', "Cache-Control": "no-store"})

    @router.post("/demo/clear")
    async def clear_demo(request: Request, body: ClearDemoInput):
        if body.confirmation != "ELIMINAR":
            raise HTTPException(400, "Escribí ELIMINAR para confirmar el borrado completo de la demostración.")
        db = request.app.state.db
        if db.get_meta("demo") != "true":
            raise HTTPException(400, "Esta base no está marcada como demostración. No se borró ningún dato.")
        folder = Path(db.path).parent / "backups"
        stamp = datetime.now().strftime("%Y-%m-%d-%H%M%S-%f")
        previous = folder / f"antes-de-vaciar-demo-{stamp}.json"
        document = make_backup(db)
        import json
        _atomic_file(previous, json.dumps(document, ensure_ascii=False, indent=2, allow_nan=False).encode("utf-8"))
        with db.transaction():
            if db.get_meta("demo") != "true":
                raise HTTPException(409, "El estado de demostración cambió; no se borró la base.")
            db.connection.execute("PRAGMA defer_foreign_keys=ON")
            for name in reversed(TABLES):
                db.connection.execute(f'DELETE FROM "{name}"')
        _plans(request).clear()
        return {"cleared": True, "previousBackup": str(previous)}

    return router

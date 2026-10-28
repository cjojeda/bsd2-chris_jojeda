"""Build a reviewable source + compiled-interface ZIP, without business data."""
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
TREES = ('src', 'public', 'dist', 'server/src', 'server/tests', 'server/docs', 'scripts', 'tests-web', 'tests-browser')
FILES = ('README.md', 'index.html', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts',
         'Iniciar-Sou-Linda-System.cmd', 'Compartir-reportes-en-celular.cmd', 'Abrir-Sou-Linda-Agil.cmd',
         'server/run.py', 'server/requirements.txt', 'server/requirements-dev.txt', 'server/pyproject.toml',
         'docs/web-local.md', 'docs/architecture-web.md', 'docs/validacion.md', 'docs/alternativa-agil.md', 'docs/referencias-treinta.md',
         '.github/workflows/web-local.yml')


def main():
    parser = argparse.ArgumentParser(description='Empaquetar Sou Linda System web local')
    parser.add_argument('--output', type=Path, default=ROOT.parent / 'Sou-Linda-System-Dos-Vistas.zip')
    args = parser.parse_args()
    if not (ROOT / 'dist/index.html').is_file():
        parser.error('Compilá la interfaz con npm run build antes de empaquetar.')
    sources = {ROOT / path for path in FILES}
    for folder in TREES:
        sources.update(path for path in (ROOT / folder).rglob('*') if path.is_file())
    if any(not path.is_file() for path in sources):
        parser.error('Falta un archivo obligatorio de la entrega.')
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(sources):
            relative = path.relative_to(ROOT)
            if any(part in ('__pycache__', '.venv', '.pytest_cache', 'node_modules') or part.endswith('.egg-info') for part in relative.parts):
                continue
            if path.suffix in ('.pyc', '.sqlite3', '.db', '.lock') or path.name == 'web-auth.json':
                continue
            archive.write(path, 'Sou-Linda-System/' + relative.as_posix())
            count += 1
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix('.zip.sha256').write_text(f'{digest}  {output.name}\n', encoding='ascii')
    print(f'{output}: {count} archivos; {output.stat().st_size} bytes; SHA256 {digest}')


if __name__ == '__main__':
    main()

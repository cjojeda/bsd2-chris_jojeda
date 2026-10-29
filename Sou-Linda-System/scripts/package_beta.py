"""Package the compiled Windows beta without user databases or build tools."""
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FILES = (
    'Probar-Sou-Linda-Beta.cmd', 'Probar-Beta-Con-Celular.cmd', 'LEEME-BETA.md',
    'scripts/Iniciar-motor.cmd', 'server/run.py', 'server/requirements.txt',
    'docs/guaranies.md',
)
TREES = ('dist', 'server/src/sadi_local')


def main():
    parser = argparse.ArgumentParser(description='Empaquetar Sou Linda System Beta 1')
    parser.add_argument('--output', type=Path, default=ROOT.parent/'Sou-Linda-System-Beta-1.zip')
    args = parser.parse_args()
    if not (ROOT/'dist/index.html').is_file():
        parser.error('Compilá la interfaz con npm run build antes de generar la beta.')
    sources = {ROOT/name for name in FILES}
    for tree in TREES:
        sources.update(path for path in (ROOT/tree).rglob('*') if path.is_file())
    if any(not path.is_file() for path in sources):
        parser.error('Falta un archivo necesario para abrir la beta.')
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for source in sorted(sources):
            relative = source.relative_to(ROOT)
            if any(part in ('__pycache__','.venv','node_modules') for part in relative.parts):
                continue
            if source.suffix in ('.pyc','.sqlite3','.db','.lock') or source.name in ('web-auth.json','sou-linda-beta.json'):
                continue
            archive.write(source, 'Sou-Linda-System-Beta/'+relative.as_posix())
            count += 1
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix('.zip.sha256').write_text(f'{digest}  {output.name}\n', encoding='ascii')
    print(f'{output}: {count} archivos; {output.stat().st_size} bytes; SHA256 {digest}')


if __name__ == '__main__':
    main()

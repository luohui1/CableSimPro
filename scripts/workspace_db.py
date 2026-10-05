"""Back up a running library, or restore after the host has stopped."""
import argparse
import json
import sqlite3
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fastapi import HTTPException
from backend.kernel.database_ops import snapshot, restore_offline, check_existing


def main():
    sys.stdout.reconfigure(encoding='utf-8');sys.stderr.reconfigure(encoding='utf-8')
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['backup','restore','version'])
    parser.add_argument('--database',type=Path,required=True)
    parser.add_argument('--output',type=Path)
    parser.add_argument('--source',type=Path)
    parser.add_argument('--sha256')
    parser.add_argument('--confirm-replace',action='store_true')
    args=parser.parse_args()
    try:
        if args.action=='backup':
            if args.output is None:parser.error('backup requires --output')
            value=snapshot(args.database,args.output)
        elif args.action=='restore':
            if not (args.source and args.sha256 and args.confirm_replace):
                parser.error('restore requires --source, --sha256 and --confirm-replace; stop the host first')
            value=restore_offline(args.database,args.source,args.sha256)
        else:value={'schema_version':check_existing(args.database)}
    except HTTPException as error:
        print(json.dumps(error.detail,ensure_ascii=False),file=sys.stderr);return 2
    except (OSError,ValueError,sqlite3.Error) as error:
        print(json.dumps({'code':'DATABASE_IO_ERROR','message':str(error)},ensure_ascii=False),file=sys.stderr);return 2
    print(json.dumps(value,ensure_ascii=False));return 0


if __name__=='__main__':raise SystemExit(main())

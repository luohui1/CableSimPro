"""An autocrlf checkout must preserve every sealed byte, including SVG assets."""
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]


def test_clean_autocrlf_checkout_verifies_all_plugin_seals(tmp_path):
    source=tmp_path/'source';source.mkdir();checkout=tmp_path/'checkout';checkout.mkdir()
    names=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z'],cwd=ROOT).decode('utf-8').split('\0')
    for name in set(names):
        if not name or not (name=='.gitattributes' or name.startswith(('backend/','cablesim_sdk/','plugins/','plugin-spec/','scripts/'))):continue
        path=ROOT/name
        if not path.is_file():continue
        target=source/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(path,target)
    def git(*args):
        result=subprocess.run(['git',*args],cwd=source,capture_output=True,text=True,encoding='utf-8',errors='replace')
        assert result.returncode==0,result.stderr
    git('init','-q');git('config','core.autocrlf','true');git('config','core.safecrlf','false')
    git('add','--all')
    # Index checkout exercises Git's actual working-tree conversion without a commit.
    git('checkout-index','--all','--force','--prefix='+checkout.as_posix()+'/')
    result=subprocess.run([sys.executable,'scripts/plugin_sdk.py','verify'],cwd=checkout,capture_output=True,text=True,encoding='utf-8',
                          env={**os.environ,'PYTHONIOENCODING':'utf-8'})
    assert result.returncode==0,result.stdout+result.stderr

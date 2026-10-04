"""Build the native OCCT WebGL viewport from pinned upstream sources on D:."""
from pathlib import Path
import argparse
import json
import os
import shutil
import subprocess
import sys
import gzip
from hashlib import sha256

ROOT = Path(__file__).resolve().parents[2]
OCCT_COMMIT = '858dd02fed80c8ca68cf1d70a6e03ecf97f849ca'
EMSDK_VERSION = '3.1.73'

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=ROOT/'.tmp/occt-build/OCCT')
    parser.add_argument('--emsdk', type=Path, default=ROOT/'.data/occt-toolchain/emsdk')
    parser.add_argument('--jobs', type=int, default=8)
    parser.add_argument('--bridge-only', action='store_true', help='Reuse the installed OCCT libraries')
    args = parser.parse_args()
    if not 1 <= args.jobs <= 32:
        parser.error('jobs must be 1–32')
    source, emsdk = args.source.resolve(), args.emsdk.resolve()
    home = ROOT/'.data/occt-toolchain'
    sdk = home/'occt'
    if args.bridge_only and not (source/'CMakeLists.txt').is_file():
        metadata = json.loads((ROOT/'design/node_modules/.cache/cablesim-occt/build.json').read_text('utf-8'))
        revision = metadata['commit']
        shaders = sdk/'share/opencascade/resources/Shaders'
        licenses = sdk/'share/doc/opencascade'
    else:
        revision = subprocess.check_output(['git','rev-parse','HEAD'],cwd=source,text=True).strip()
        shaders, licenses = source/'src/Shaders', source
    if revision != OCCT_COMMIT:
        raise SystemExit('Expected OCCT V7_9_0 commit '+OCCT_COMMIT)
    scratch = ROOT/'.tmp/occt-build'
    scratch.mkdir(parents=True, exist_ok=True)
    home.mkdir(parents=True, exist_ok=True)
    cmake_candidates = [ROOT/'.venv/Lib/site-packages/cmake/data/bin/cmake.exe',
                        home/'cmake/cmake-3.31.6-windows-x86_64/bin/cmake.exe']
    cmake = next((p for p in cmake_candidates if p.is_file()), None)
    ninja = home/'ninja/ninja.exe'
    em = emsdk/'upstream/emscripten'
    if cmake is None or not ninja.is_file() or not (em/'emcc.py').is_file():
        raise SystemExit('Install CMake, Ninja and Emscripten '+EMSDK_VERSION+' in .data/occt-toolchain first')
    if (em/'emscripten-version.txt').read_text().strip().strip('"') != EMSDK_VERSION:
        raise SystemExit('Expected Emscripten '+EMSDK_VERSION)
    node = shutil.which('node')
    if not node:
        raise SystemExit('Node.js is required')
    config = home/'emscripten-config.py'
    config.write_text('\n'.join([
        'LLVM_ROOT = '+repr(str(emsdk/'upstream/bin')),
        'BINARYEN_ROOT = '+repr(str(emsdk/'upstream')),
        'NODE_JS = ['+repr(node)+']',
        'CACHE = '+repr(str(emsdk/'upstream/emscripten/cache')),
    ])+'\n',encoding='utf-8')
    env = dict(os.environ, EM_CONFIG=str(config), EMSDK=str(emsdk),
               EMSDK_PYTHON=sys.executable, EMSDK_NODE=node, TEMP=str(scratch), TMP=str(scratch),
               PYTHONIOENCODING='utf-8', PYTHONUTF8='1', PROCESSOR_ARCHITECTURE='AMD64')
    env['PATH'] = str(ninja.parent)+os.pathsep+str(cmake.parent)+os.pathsep+env.get('PATH','')
    def run(*cmd):
        subprocess.run([str(c) for c in cmd],cwd=ROOT,env=env,check=True)
    sdk, build, bridge = home/'occt', scratch/'libraries', scratch/'viewer'
    common = ['-G','Ninja','-DCMAKE_MAKE_PROGRAM='+str(ninja),
              '-DCMAKE_TOOLCHAIN_FILE='+str(em/'cmake/Modules/Platform/Emscripten.cmake'),
              '-DCMAKE_BUILD_TYPE=Release','-DCMAKE_CXX_FLAGS=-O2 -fexceptions',
              '-DCMAKE_CXX_FLAGS_RELEASE=-O2 -DNDEBUG','-DCMAKE_CXX_STANDARD=17']
    modules = ['FoundationClasses','ModelingData','ModelingAlgorithms','Visualization','ApplicationFramework','DataExchange','Draw','DETools']
    if not args.bridge_only:
        run(cmake,'-S',source,'-B',build,*common,
            *['-DBUILD_MODULE_'+m+'=OFF' for m in modules],
            '-DBUILD_ADDITIONAL_TOOLKITS=TKV3d;TKOpenGles','-DBUILD_LIBRARY_TYPE=Static',
            '-DBUILD_USE_PCH=OFF','-DUSE_FREETYPE=OFF','-DUSE_TBB=OFF','-DUSE_TCL=OFF','-DUSE_TK=OFF',
            '-DINSTALL_DIR='+str(sdk),'-DCMAKE_INSTALL_PREFIX='+str(sdk),
            '-DINSTALL_DIR_LIB=lib','-DINSTALL_DIR_INCLUDE=include/opencascade',
            '-DINSTALL_DIR_CMAKE=lib/cmake/opencascade')
        run(cmake,'--build',build,'--parallel',args.jobs)
        run(cmake,'--install',build)
    run(cmake,'-S',ROOT/'design/workbench/occt','-B',bridge,*common,
        '-DOpenCASCADE_DIR='+str(sdk/'lib/cmake/opencascade'),'-DOCCT_SHADERS='+str(shaders))
    run(cmake,'--build',bridge,'--parallel',args.jobs)
    target = ROOT/'design/node_modules/.cache/cablesim-occt'
    target.mkdir(parents=True,exist_ok=True)
    assets={}
    for name in ('occt-viewer.js','occt-viewer.wasm'):
        shutil.copyfile(bridge/name,target/name)
        content=(target/name).read_bytes();assets[name]=sha256(content).hexdigest()
        if name.endswith('.wasm'):(target/(name+'.gz')).write_bytes(gzip.compress(content,compresslevel=6,mtime=0))
    for name in ('LICENSE_LGPL_21.txt','OCCT_LGPL_EXCEPTION.txt'):
        shutil.copyfile(licenses/name,target/name)
    (target/'build.json').write_text(json.dumps({'occt':'7.9.0','commit':revision,'emscripten':EMSDK_VERSION,
        'renderer':'AIS/V3d/TKOpenGles','units':'mm','assets':assets},indent=2)+'\n',encoding='utf-8')
    print('Built OCCT CAD viewport: '+str(target))

if __name__ == '__main__':
    main()


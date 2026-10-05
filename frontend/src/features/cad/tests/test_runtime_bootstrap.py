"""Offline checks for downloaded artifact integrity and safe extraction."""
import hashlib
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'native'))
from prepare import download, install, normalize_version


class BootstrapTests(unittest.TestCase):
    def setUp(self):
        scratch = Path(__file__).resolve().parents[5]/'.tmp/frontend'
        scratch.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(dir=scratch, prefix='occt-bootstrap-')
        self.root = Path(self.temporary.name)
        self.addCleanup(self.temporary.cleanup)

    def archive(self, entry='prefix/bin/tool.exe'):
        archive = self.root/'upstream.zip'
        with zipfile.ZipFile(archive, 'w') as bundle:
            bundle.writestr(entry, 'verified bytes')
        return {'url': archive.as_uri(), 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'strip_components': 1}

    def test_bad_download_is_rejected_without_partial_cache(self):
        record = self.archive()
        record['sha256'] = '0'*64
        with self.assertRaisesRegex(RuntimeError, 'SHA256 mismatch'):
            download(record, self.root/'cache')
        self.assertEqual(list((self.root/'cache').iterdir()), [])

    def test_changed_install_is_restored_from_verified_cache_offline(self):
        record = self.archive()
        destination = install('tool', record, self.root/'cache', self.root/'home')
        tool = destination/'bin/tool.exe'
        self.assertEqual(tool.read_text(), 'verified bytes')
        tool.write_text('tampered')
        (self.root/'upstream.zip').unlink()
        install('tool', record, self.root/'cache', self.root/'home')
        self.assertEqual(tool.read_text(), 'verified bytes')
        install('tool', record, self.root/'cache', self.root/'home')

    def test_archive_cannot_escape_installation(self):
        record = self.archive('../escaped.exe')
        with self.assertRaisesRegex(RuntimeError, 'Unsafe archive entry'):
            install('tool', record, self.root/'cache', self.root/'home')
        self.assertFalse((self.root/'escaped.exe').exists())

    def test_official_emsdk_release_marker_is_normalized_and_unknown_version_rejected(self):
        version = self.root/'upstream/emscripten/emscripten-version.txt'
        version.parent.mkdir(parents=True)
        version.write_text('3.1.73-git\n')
        self.assertTrue(normalize_version('emscripten', self.root))
        self.assertEqual(version.read_text(), '"3.1.73"\n')
        self.assertFalse(normalize_version('emscripten', self.root))
        version.write_text('4.0.0-git\n')
        with self.assertRaisesRegex(RuntimeError, 'unexpected version'):
            normalize_version('emscripten', self.root)

    @unittest.skipUnless(shutil.which('git'), 'Git is required for clean checkout verification')
    def test_windows_git_checkout_preserves_native_source_digests(self):
        native = Path(__file__).resolve().parents[1]/'native'
        repository = self.root/'source'
        checkout = self.root/'checkout'
        repository.mkdir()
        checkout.mkdir()
        files = [p for p in native.iterdir() if p.is_file()]
        for source in files:
            shutil.copyfile(source, repository/source.name)
        def git(*arguments):
            subprocess.run(['git', '-C', str(repository), '-c', 'core.autocrlf=true', *arguments],
                           check=True, capture_output=True)
        git('init')
        git('add', '.')
        git('checkout-index', '--all', '--prefix='+checkout.as_posix()+'/')
        for source in files:
            self.assertEqual(hashlib.sha256(source.read_bytes()).digest(),
                             hashlib.sha256((checkout/source.name).read_bytes()).digest(), source.name)


if __name__ == '__main__':
    unittest.main()

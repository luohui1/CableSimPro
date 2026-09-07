"""Isolated, bounded PDF text-layer parser (not OCR). Launched by the library service."""
import json
import sys
from pathlib import Path


def parse(path):
    try:
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (768 * 1024 * 1024, 768 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_CPU, (15, 15))
    except (ImportError, ValueError):
        pass
    from pypdf import PdfReader
    reader = PdfReader(path, strict=False)
    if reader.is_encrypted:
        raise ValueError('请先在本机解密 PDF；不接受加密文件。')
    if not 1 <= len(reader.pages) <= 50:
        raise ValueError('单个 PDF 限制为 1–50 页。')
    pages = []
    total = 0
    for index, page in enumerate(reader.pages):
        content = page.get_contents()
        if content is not None and len(content.get_data()) > 12 * 1024 * 1024:
            raise ValueError('PDF 单页内容流过大。')
        text = page.extract_text() or ''
        if len(text) > 30000:
            raise ValueError('PDF 单页文字超过 30000 字符，请拆分资料。')
        total += len(text)
        if total > 500000:
            raise ValueError('单份资料文字超过 500000 字符。')
        pages.append({'page': index + 1, 'text': text, 'method': 'pdf-text-layer'})
    return pages


if __name__ == '__main__':
    try:
        print(json.dumps({'pages': parse(Path(sys.argv[1]))}, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({'error': str(exc)[:200] if isinstance(exc, ValueError) else 'PDF 解析失败，请检查文件完整性或改用 OCR。'}, ensure_ascii=False))
        sys.exit(1)

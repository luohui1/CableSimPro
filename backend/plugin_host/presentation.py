"""Read sealed static plugin assets; never execute SVG or load frontend code."""
from hashlib import sha256
import re
import xml.etree.ElementTree as ET

from .registry import PluginHostError


def resources(plugin):
    presentation = plugin.manifest.presentation
    if presentation is None:
        return []
    files = {record.path: record for record in plugin.manifest.files}
    return [{**asset.model_dump(mode='json'), 'sha256': files[asset.path].sha256,
             'size_bytes': files[asset.path].size_bytes,
             'url': f'/api/plugins/{plugin.manifest.id}/assets/{asset.role}?sha256={files[asset.path].sha256}'}
            for asset in presentation.assets]


def asset_bytes(plugin, role, expected_digest=None):
    plugin.verify()
    resource = next((item for item in resources(plugin) if item['role'] == role), None)
    if resource is None:
        raise PluginHostError('PLUGIN_ASSET_NOT_FOUND', '插件没有此展示资源。', 404)
    if expected_digest and expected_digest != resource['sha256']:
        raise PluginHostError('PLUGIN_ASSET_VERSION_CHANGED', '资源版本已变化，请读取当前清单。', 409)
    data = (plugin.directory / resource['path']).read_bytes()
    if len(data) != resource['size_bytes'] or sha256(data).hexdigest() != resource['sha256']:
        raise PluginHostError('PLUGIN_ASSET_DIGEST_MISMATCH', '展示资源与封签摘要不一致。', 409)
    if resource['media_type'] == 'image/webp':
        if not (len(data) >= 12 and data[:4] == b'RIFF' and data[8:12] == b'WEBP'):
            raise PluginHostError('PLUGIN_ASSET_INVALID', '封面不是 WebP 文件。', 409)
    else:
        validate_svg(data)
    return data, resource


def validate_svg(data):
    if len(data) > 2 * 1024 * 1024 or re.search(br'<!DOCTYPE|<!ENTITY', data, re.I):
        raise PluginHostError('PLUGIN_ASSET_INVALID', '方法图超出大小限制或含实体声明。', 409)
    try:
        root = ET.fromstring(data)
    except ET.ParseError:
        raise PluginHostError('PLUGIN_ASSET_INVALID', '方法图不是有效 SVG。', 409) from None
    allowed = {'svg', 'g', 'title', 'desc', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline',
               'polygon', 'text', 'tspan', 'defs', 'marker', 'clipPath', 'use', 'style', 'metadata',
               'RDF', 'Work', 'type', 'format', 'creator', 'Agent', 'title', 'date', 'description'}
    if root.tag != '{http://www.w3.org/2000/svg}svg':
        raise PluginHostError('PLUGIN_ASSET_INVALID', '方法图缺少 SVG 命名空间。', 409)
    for node in root.iter():
        if node.tag.split('}')[-1] not in allowed:
            raise PluginHostError('PLUGIN_ASSET_INVALID', '方法图包含主动或不允许的元素。', 409)
        for key, value in node.attrib.items():
            local = key.split('}')[-1].lower()
            if local.startswith('on') or (local == 'href' and not value.startswith('#')):
                raise PluginHostError('PLUGIN_ASSET_INVALID', '方法图禁止脚本和外部引用。', 409)
            if 'url(' in value and re.search(r'url\(\s*[\'"]?(?!#)[^)]', value):
                raise PluginHostError('PLUGIN_ASSET_INVALID', '方法图禁止外部资源。', 409)
        if node.tag.endswith('}style') and re.search(r'@import|url\(', node.text or '', re.I):
            raise PluginHostError('PLUGIN_ASSET_INVALID', '方法图样式禁止加载外部资源。', 409)

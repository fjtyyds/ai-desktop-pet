'use strict';

/**
 * T-43 皮肤包 MVP（ADR-032 上线方案）：本地皮肤包导入/导出/索引/卸载。
 *
 * 皮肤包格式：JSON 清单 + PNG 资源，支持目录或 zip 两种形态。
 * 安全边界（硬性）：
 * - 包内仅允许 .png 与 .json 文件；可执行文件（exe/bat/ps1/sh/dll 等）
 *   与脚本（js/html/svg 等）一律拒绝；
 * - 包总大小上限 10 MB、条目数上限 50；
 * - 路径禁止绝对路径、盘符与 `..` 跳转；
 * - zip 为纯 Node 实现（store/deflate，CRC32 校验），不调用外部命令，
 *   不执行包内任何代码；zip 加密与未知压缩方式直接拒绝。
 *
 * 目录结构（manifest.json 必须在包根目录）：
 *   manifest.json      { id, name, author, version, preview, roleAssets }
 *   preview.png        列表预览图（必填，PNG）
 *   assets/idle.png    角色资源（roleAssets 引用，PNG）
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

/** 皮肤 id 上限（与 src/storage/store.js 的 SKIN_ID_MAX_LENGTH 保持一致） */
const SKIN_ID_MAX_LENGTH = 64;
/** 内置默认皮肤 id（不可导入/移除） */
const DEFAULT_SKIN_ID = 'default';
/** 皮肤包总大小上限（10 MB） */
const MAX_PACK_BYTES = 10 * 1024 * 1024;
/** 包内文件条目数上限（zip 炸弹防护） */
const MAX_PACK_ENTRIES = 50;
/** 清单文件名（必须在包根目录） */
const MANIFEST_NAME = 'manifest.json';
/** T-55：Codex 宠物包清单文件名（pet.json + spritesheet.webp，8 列×9 行动画图集） */
const PET_MANIFEST_NAME = 'pet.json';
/** 允许的包内文件扩展名：仅 PNG 与 JSON（含清单）；其余一律拒绝 */
const ALLOWED_EXTENSIONS = new Set(['.png', '.json', '.webp']);
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const ASSET_KEY_PATTERN = /^[a-z0-9_-]{1,32}$/;

/** 皮肤包错误（携带对用户可读的说明） */
class SkinError extends Error {}

/* ---------------- CRC32 ---------------- */

let CRC_TABLE = null;
function crc32(buffer) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/* ---------------- 纯 Node zip 读写 ---------------- */

function writeZip(files) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;
  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // 本地文件头签名
    local.writeUInt16LE(20, 4); // 解压所需版本
    local.writeUInt16LE(0, 6); // 通用标志（无加密/无描述符）
    local.writeUInt16LE(8, 8); // 压缩方式：deflate
    local.writeUInt16LE(0, 10); // 修改时间
    local.writeUInt16LE(0, 12); // 修改日期
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // 扩展字段长度
    localChunks.push(local, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // 中央目录签名
    central.writeUInt16LE(20, 4); // 创建版本
    central.writeUInt16LE(20, 6); // 解压所需版本
    central.writeUInt16LE(0, 8); // 通用标志
    central.writeUInt16LE(8, 10); // 压缩方式
    central.writeUInt16LE(0, 12); // 修改时间
    central.writeUInt16LE(0, 14); // 修改日期
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // 扩展字段长度
    central.writeUInt16LE(0, 32); // 注释长度
    central.writeUInt16LE(0, 34); // 起始磁盘
    central.writeUInt16LE(0, 36); // 内部属性
    central.writeUInt32LE(0, 38); // 外部属性
    central.writeUInt32LE(offset, 42); // 本地头偏移
    centralChunks.push(central, nameBuf);

    offset += 30 + nameBuf.length + compressed.length;
  }

  const centralSize = centralChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // 结束目录签名
  eocd.writeUInt16LE(0, 4); // 当前磁盘
  eocd.writeUInt16LE(0, 6); // 中央目录起始磁盘
  eocd.writeUInt16LE(files.length, 8); // 当前磁盘条目数
  eocd.writeUInt16LE(files.length, 10); // 总条目数
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // 注释长度
  return Buffer.concat([...localChunks, ...centralChunks, eocd]);
}

/** 从 zip 尾部向前找结束目录记录（考虑注释长度） */
function findEndOfCentralDirectory(buffer) {
  const min = Math.max(0, buffer.length - 22 - 65535);
  for (let i = buffer.length - 22; i >= min; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      const commentLen = buffer.readUInt16LE(i + 20);
      if (i + 22 + commentLen === buffer.length) {
        return i;
      }
    }
  }
  throw new SkinError('不是有效的 zip 文件（缺少结束目录记录）');
}

/**
 * 读取 zip 为 [{ name, data }]：
 * - 拒绝加密（通用标志 bit0）、非 store/deflate 压缩方式；
 * - 拒绝解压后超上限的条目（zip 炸弹防护）；
 * - 按中央目录解压并对每个条目做 CRC32 校验。
 */
function readZip(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) {
    throw new SkinError('zip 文件损坏或过小');
  }
  const eocd = findEndOfCentralDirectory(buffer);
  const count = buffer.readUInt16LE(eocd + 10);
  if (count > MAX_PACK_ENTRIES) {
    throw new SkinError(`zip 条目数超过上限 ${MAX_PACK_ENTRIES}`);
  }
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  const files = [];
  let total = 0;
  let offset = cdOffset;
  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > buffer.length) {
      throw new SkinError('zip 中央目录损坏');
    }
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new SkinError('zip 中央目录签名损坏');
    }
    const flags = buffer.readUInt16LE(offset + 8);
    if (flags & 0x1) {
      throw new SkinError('不支持加密的 zip');
    }
    const method = buffer.readUInt16LE(offset + 10);
    if (method !== 0 && method !== 8) {
      throw new SkinError(`不支持的 zip 压缩方式: ${method}`);
    }
    const crc = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    if (uncompressedSize > MAX_PACK_BYTES || compressedSize > buffer.length) {
      throw new SkinError('zip 条目尺寸异常');
    }
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    if (
      localOffset + 30 > buffer.length ||
      buffer.readUInt32LE(localOffset) !== 0x04034b50
    ) {
      throw new SkinError('zip 本地文件头损坏');
    }
    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLen + localExtraLen;
    if (dataOffset + compressedSize > buffer.length) {
      throw new SkinError('zip 数据越界');
    }
    const raw = buffer.subarray(dataOffset, dataOffset + compressedSize);
    let data;
    try {
      data =
        method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw);
    } catch (error) {
      throw new SkinError(`zip 解压失败: ${error && error.message ? error.message : error}`);
    }
    if (data.length !== uncompressedSize) {
      throw new SkinError('zip 解压后大小与目录不一致');
    }
    if (crc32(data) !== crc) {
      throw new SkinError('zip CRC32 校验失败');
    }
    total += data.length;
    if (total > MAX_PACK_BYTES) {
      throw new SkinError(`zip 解压后超过大小上限 ${MAX_PACK_BYTES} 字节`);
    }
    files.push({
      name: buffer.toString('utf8', offset + 46, offset + 46 + nameLen),
      data
    });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/* ---------------- 包路径与清单校验 ---------------- */

/** 归一化包内相对路径：拒绝绝对路径/盘符/上级跳转/控制字符 */
function normalizeEntryName(raw) {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new SkinError('包内存在空文件名');
  }
  if (raw.length > 256) {
    throw new SkinError('包内文件名过长');
  }
  if (
    raw.startsWith('/') ||
    raw.startsWith('\\') ||
    /^[a-zA-Z]:/.test(raw) ||
    raw.includes(':')
  ) {
    throw new SkinError(`包内存在非法路径: ${raw}`);
  }
  const parts = raw.replace(/\\/g, '/').split('/');
  const cleaned = [];
  for (const part of parts) {
    if (part === '' || part === '.') {
      continue;
    }
    if (part === '..') {
      throw new SkinError(`包内路径包含上级跳转: ${raw}`);
    }
    if (/[\u0000-\u001f]/.test(part)) {
      throw new SkinError(`包内路径包含控制字符: ${raw}`);
    }
    cleaned.push(part);
  }
  if (cleaned.length === 0) {
    throw new SkinError(`包内存在非法路径: ${raw}`);
  }
  return cleaned.join('/');
}

/** 解析并校验 manifest.json（含引用资源存在性） */
function parseManifest(buffer, fileNames) {
  let manifest;
  try {
    manifest = JSON.parse(buffer.toString('utf8'));
  } catch (_error) {
    throw new SkinError('manifest.json 不是合法 JSON');
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new SkinError('manifest.json 必须为 JSON 对象');
  }
  const id = typeof manifest.id === 'string' ? manifest.id.trim() : '';
  if (!ID_PATTERN.test(id)) {
    throw new SkinError(
      'manifest.id 非法（须为 1~64 位小写字母/数字/-/_，且以字母或数字开头）'
    );
  }
  if (id === DEFAULT_SKIN_ID) {
    throw new SkinError('default 为内置皮肤 id，不可导入');
  }
  const name = typeof manifest.name === 'string' ? manifest.name.trim() : '';
  if (!name || name.length > 80) {
    throw new SkinError('manifest.name 须为 1~80 字符的非空字符串');
  }
  const author = typeof manifest.author === 'string' ? manifest.author.trim() : '';
  if (author.length > 80) {
    throw new SkinError('manifest.author 超长（上限 80 字符）');
  }
  const version = typeof manifest.version === 'string' ? manifest.version.trim() : '';
  if (!version || version.length > 20) {
    throw new SkinError('manifest.version 须为 1~20 字符的非空字符串');
  }
  const preview = typeof manifest.preview === 'string' ? manifest.preview.trim() : '';
  if (!preview || path.extname(preview).toLowerCase() !== '.png') {
    throw new SkinError('manifest.preview 必须引用包内 PNG');
  }
  const roleAssets = manifest.roleAssets;
  if (
    !roleAssets ||
    typeof roleAssets !== 'object' ||
    Array.isArray(roleAssets) ||
    Object.keys(roleAssets).length === 0
  ) {
    throw new SkinError('manifest.roleAssets 必须为非空对象（如 { "idle": "assets/idle.png" }）');
  }
  for (const [key, value] of Object.entries(roleAssets)) {
    if (!ASSET_KEY_PATTERN.test(key)) {
      throw new SkinError(`manifest.roleAssets 键非法: ${key}`);
    }
    if (typeof value !== 'string' || path.extname(value).toLowerCase() !== '.png') {
      throw new SkinError(`manifest.roleAssets.${key} 必须引用包内 PNG`);
    }
  }
  const references = [preview, ...Object.values(roleAssets)];
  for (const ref of references) {
    const normalized = normalizeEntryName(ref);
    if (!fileNames.has(normalized)) {
      throw new SkinError(`清单引用的资源不存在: ${ref}`);
    }
  }
  return { id, name, author, version, preview, roleAssets };
}

/**
 * 解析 WebP 画布尺寸（T-55）：
 * - VP8X（含透明/动画的扩展头）优先；canvas width/height 为 24 位小端 +1；
 * - 无 VP8X 时回退 VP8（有损）与 VP8L（无损）帧头。
 * 无法解析时返回 null，导入校验据此拒绝。
 */
function parseWebpSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 20) {
    return null;
  }
  if (
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    return null;
  }
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const fourcc = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    if (fourcc === 'VP8X' && dataStart + 10 <= buffer.length) {
      return {
        width: 1 + buffer.readUIntLE(dataStart + 4, 3),
        height: 1 + buffer.readUIntLE(dataStart + 7, 3)
      };
    }
    if (fourcc === 'VP8 ' && dataStart + 10 <= buffer.length) {
      const width = buffer.readUInt16LE(dataStart + 6) & 0x3fff;
      const height = buffer.readUInt16LE(dataStart + 8) & 0x3fff;
      if (width > 0 && height > 0) {
        return { width, height };
      }
    }
    if (fourcc === 'VP8L' && dataStart + 5 <= buffer.length) {
      const bits = buffer.readUInt32LE(dataStart + 1);
      const width = (bits & 0x3fff) + 1;
      const height = ((bits >> 14) & 0x3fff) + 1;
      if (width > 0 && height > 0) {
        return { width, height };
      }
    }
    offset = dataStart + size + (size % 2);
  }
  return null;
}

/** 校验 Codex 宠物包图集：8 列×9 行、单元格 64~512 像素 */
function validateAtlasSize(buffer) {
  const dims = parseWebpSize(buffer);
  if (!dims) {
    throw new SkinError('spritesheet.webp 无法解析尺寸（需要有效的 WebP 文件）');
  }
  if (dims.width % 8 !== 0 || dims.height % 9 !== 0) {
    throw new SkinError(
      `spritesheet.webp 需为 8 列×9 行动画图集，实际 ${dims.width}×${dims.height}`
    );
  }
  const cellWidth = dims.width / 8;
  const cellHeight = dims.height / 9;
  if (cellWidth < 64 || cellWidth > 512 || cellHeight < 64 || cellHeight > 512) {
    throw new SkinError(
      `spritesheet.webp 单元格尺寸超出 64~512 像素（实际 ${cellWidth}×${cellHeight}）`
    );
  }
  return { cols: 8, rows: 9, cellWidth, cellHeight };
}

/**
 * 解析并校验 pet.json（Codex 宠物包清单，T-55）：
 * { id, displayName, description, spritesheetPath }
 */
function parsePetManifest(buffer, fileNames) {
  let manifest;
  try {
    manifest = JSON.parse(buffer.toString('utf8'));
  } catch (_error) {
    throw new SkinError('pet.json 不是合法 JSON');
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new SkinError('pet.json 必须为 JSON 对象');
  }
  const id = typeof manifest.id === 'string' ? manifest.id.trim() : '';
  if (!ID_PATTERN.test(id)) {
    throw new SkinError(
      'pet.json.id 非法（须为 1~64 位小写字母/数字/-/_，且以字母或数字开头）'
    );
  }
  if (id === DEFAULT_SKIN_ID) {
    throw new SkinError('default 为内置皮肤 id，不可导入');
  }
  const displayName =
    typeof manifest.displayName === 'string' ? manifest.displayName.trim() : '';
  if (!displayName || displayName.length > 80) {
    throw new SkinError('pet.json.displayName 须为 1~80 字符的非空字符串');
  }
  const description =
    typeof manifest.description === 'string' ? manifest.description.trim() : '';
  if (description.length > 200) {
    throw new SkinError('pet.json.description 超长（上限 200 字符）');
  }
  const spritesheet =
    typeof manifest.spritesheetPath === 'string'
      ? manifest.spritesheetPath.trim()
      : '';
  if (!spritesheet || path.extname(spritesheet).toLowerCase() !== '.webp') {
    throw new SkinError('pet.json.spritesheetPath 必须引用包内 .webp 文件');
  }
  const normalized = normalizeEntryName(spritesheet);
  if (!fileNames.has(normalized)) {
    throw new SkinError(`pet.json 引用的 spritesheet 不存在: ${spritesheet}`);
  }
  return {
    id,
    name: displayName,
    author: '',
    version: '1.0.0',
    preview: spritesheet,
    spritesheetPath: normalized,
    description
  };
}

/**
 * 校验整包文件（目录或 zip 解压后统一入口）：
 * - 大小/条目数/扩展名/重复/路径；
 * - manifest.json 或 pet.json 必须存在且引用资源均在包内。
 */
function validateSkinPackFiles(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new SkinError('皮肤包为空');
  }
  if (files.length > MAX_PACK_ENTRIES) {
    throw new SkinError(`包内文件数超过上限 ${MAX_PACK_ENTRIES}`);
  }
  const seen = new Set();
  const fileNames = new Set();
  let total = 0;
  for (const file of files) {
    if (!file || typeof file.name !== 'string' || !Buffer.isBuffer(file.data)) {
      throw new SkinError('包内文件条目格式非法');
    }
    const name = normalizeEntryName(file.name);
    if (seen.has(name)) {
      throw new SkinError(`包内存在重复文件: ${name}`);
    }
    seen.add(name);
    if (file.data.length > MAX_PACK_BYTES) {
      throw new SkinError(`包内文件超过大小上限: ${name}`);
    }
    total += file.data.length;
    if (total > MAX_PACK_BYTES) {
      throw new SkinError(`皮肤包超过大小上限 ${MAX_PACK_BYTES} 字节`);
    }
    const ext = path.extname(name).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new SkinError(
        `包内包含不允许的文件类型: ${name}（仅允许 .png/.json/.webp，拒绝可执行文件与脚本）`
      );
    }
    fileNames.add(name);
  }
  const hasManifest = fileNames.has(MANIFEST_NAME);
  const hasPetManifest = fileNames.has(PET_MANIFEST_NAME);
  if (!hasManifest && !hasPetManifest) {
    throw new SkinError('缺少 manifest.json 或 pet.json 清单');
  }
  if (hasManifest && hasPetManifest) {
    throw new SkinError('包内不能同时包含 manifest.json 与 pet.json');
  }
  let manifest = null;
  let atlas = null;
  if (hasManifest) {
    const manifestFile = files.find(
      (file) => normalizeEntryName(file.name) === MANIFEST_NAME
    );
    manifest = parseManifest(manifestFile.data, fileNames);
  } else {
    const petFile = files.find(
      (file) => normalizeEntryName(file.name) === PET_MANIFEST_NAME
    );
    manifest = parsePetManifest(petFile.data, fileNames);
    const spriteFile = files.find(
      (file) => normalizeEntryName(file.name) === manifest.spritesheetPath
    );
    atlas = validateAtlasSize(spriteFile.data);
  }
  return {
    manifest,
    atlas,
    files: files.map((file) => ({ name: normalizeEntryName(file.name), data: file.data }))
  };
}

/** 递归收集目录包文件（拒绝符号链接与非普通文件） */
function collectDirectoryPack(dir) {
  const files = [];
  function walk(current, prefix) {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (error) {
      throw new SkinError(`读取目录失败: ${error && error.message ? error.message : error}`);
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        throw new SkinError(`目录包含符号链接（已拒绝）: ${entry.name}`);
      }
      if (entry.isDirectory()) {
        walk(full, prefix ? `${prefix}/${entry.name}` : entry.name);
      } else if (entry.isFile()) {
        const stat = fs.statSync(full);
        if (stat.size > MAX_PACK_BYTES) {
          throw new SkinError(`包内文件超过大小上限: ${entry.name}`);
        }
        files.push({
          name: prefix ? `${prefix}/${entry.name}` : entry.name,
          data: fs.readFileSync(full)
        });
      } else {
        throw new SkinError(`目录包含不支持的文件类型: ${entry.name}`);
      }
    }
  }
  walk(dir, '');
  return files;
}

/* ---------------- 皮肤存储 ---------------- */

function toDataUrl(filePath) {
  const data = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime =
    ext === '.png'
      ? 'image/png'
      : ext === '.webp'
        ? 'image/webp'
        : 'application/octet-stream';
  return `data:${mime};base64,${data.toString('base64')}`;
}

/** T-59：Codex 宠物目录默认位置（env CODEX_HOME 优先，否则 HOME/.codex） */
function defaultCodexPetsDir() {
  const codexHome =
    typeof process.env.CODEX_HOME === 'string' && process.env.CODEX_HOME.trim()
      ? process.env.CODEX_HOME.trim()
      : '';
  const home =
    typeof process.env.HOME === 'string' && process.env.HOME.trim()
      ? process.env.HOME.trim()
      : os.homedir();
  const base = codexHome || path.join(home, '.codex');
  return path.join(base, 'pets');
}

/**
 * 创建皮肤存储：
 * - baseDir：用户数据目录下的 skins/（导入包持久化位置）
 * - defaultsDir：内置默认皮肤目录（src/main/default-skins）
 */
function createSkinStore(options = {}) {
  const baseDir = options.baseDir || path.join(process.cwd(), 'skins');
  const defaultsDir =
    options.defaultsDir || path.join(__dirname, 'default-skins');

  function builtinIds() {
    if (!fs.existsSync(defaultsDir)) {
      return [];
    }
    return fs
      .readdirSync(defaultsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  }

  function isBuiltin(id) {
    return builtinIds().includes(id);
  }

  function skinDir(id) {
    if (!ID_PATTERN.test(id)) {
      throw new SkinError(`皮肤 id 非法: ${id}`);
    }
    return path.join(isBuiltin(id) ? defaultsDir : baseDir, id);
  }

  function readManifest(dir) {
    const manifestPath = path.join(dir, MANIFEST_NAME);
    if (!fs.existsSync(manifestPath)) {
      throw new SkinError(`皮肤缺少 ${MANIFEST_NAME}: ${dir}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      throw new SkinError(`manifest.json 解析失败: ${error && error.message ? error.message : error}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new SkinError('manifest.json 必须为 JSON 对象');
    }
    return parsed;
  }

  /** 读取 Codex 宠物包 pet.json（T-55） */
  function readPetManifest(dir) {
    const manifestPath = path.join(dir, PET_MANIFEST_NAME);
    if (!fs.existsSync(manifestPath)) {
      throw new SkinError(`宠物包缺少 ${PET_MANIFEST_NAME}: ${dir}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      throw new SkinError(
        `pet.json 解析失败: ${error && error.message ? error.message : error}`
      );
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new SkinError('pet.json 必须为 JSON 对象');
    }
    return parsed;
  }

  /** Codex 宠物包目录条目：图集 data URL + 网格信息 */
  function petEntryFromDir(dir, id, builtin) {
    const pet = readPetManifest(dir);
    const spritesheetRel =
      typeof pet.spritesheetPath === 'string' && pet.spritesheetPath.trim()
        ? pet.spritesheetPath.trim()
        : '';
    if (!spritesheetRel) {
      throw new SkinError('pet.json.spritesheetPath 缺失');
    }
    const spritesheetPath = path.join(dir, normalizeEntryName(spritesheetRel));
    const dims = parseWebpSize(fs.readFileSync(spritesheetPath));
    if (!dims || dims.width % 8 !== 0 || dims.height % 9 !== 0) {
      throw new SkinError('spritesheet.webp 不是 8 列×9 行动画图集');
    }
    const previewRel =
      typeof pet.preview === 'string' &&
      pet.preview.trim() &&
      fs.existsSync(path.join(dir, normalizeEntryName(pet.preview)))
        ? pet.preview
        : spritesheetRel;
    return {
      id,
      name: typeof pet.displayName === 'string' ? pet.displayName : id,
      author: '',
      version: '1.0.0',
      builtin,
      kind: 'atlas',
      description: typeof pet.description === 'string' ? pet.description : '',
      previewDataUrl: toDataUrl(path.join(dir, normalizeEntryName(previewRel))),
      roleAssets: {},
      spritesheetDataUrl: toDataUrl(spritesheetPath),
      atlas: {
        cols: 8,
        rows: 9,
        cellWidth: dims.width / 8,
        cellHeight: dims.height / 9
      }
    };
  }

  function entryFromDir(dir, id, builtin) {
    if (fs.existsSync(path.join(dir, PET_MANIFEST_NAME))) {
      return petEntryFromDir(dir, id, builtin);
    }
    const manifest = readManifest(dir);
    const previewPath = path.join(dir, normalizeEntryName(manifest.preview || ''));
    const roleAssets = {};
    const rawAssets =
      manifest.roleAssets && typeof manifest.roleAssets === 'object'
        ? manifest.roleAssets
        : {};
    for (const [key, rel] of Object.entries(rawAssets)) {
      if (typeof rel === 'string' && rel.trim()) {
        roleAssets[key] = toDataUrl(path.join(dir, normalizeEntryName(rel)));
      }
    }
    return {
      id,
      name: typeof manifest.name === 'string' ? manifest.name : id,
      author: typeof manifest.author === 'string' ? manifest.author : '',
      version: typeof manifest.version === 'string' ? manifest.version : '',
      builtin,
      kind: 'static',
      previewDataUrl: fs.existsSync(previewPath) ? toDataUrl(previewPath) : '',
      roleAssets
    };
  }

  function list() {
    const entries = [];
    for (const id of builtinIds()) {
      try {
        entries.push(entryFromDir(path.join(defaultsDir, id), id, true));
      } catch (error) {
        // 内置皮肤损坏时跳过，不崩溃
        console.warn(`[skin] 内置皮肤读取失败（跳过）: ${id}`, error && error.message);
      }
    }
    if (fs.existsSync(baseDir)) {
      for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
          continue;
        }
        try {
          entries.push(entryFromDir(path.join(baseDir, entry.name), entry.name, false));
        } catch (_error) {
          // 损坏的导入包跳过（list 不崩溃；重新导入同 id 可覆盖）
        }
      }
    }
    entries.sort((a, b) => {
      if (a.builtin !== b.builtin) {
        return a.builtin ? -1 : 1;
      }
      return a.id.localeCompare(b.id);
    });
    return entries;
  }

  function find(id) {
    if (typeof id !== 'string' || !id.trim()) {
      return null;
    }
    return list().find((item) => item.id === id) || null;
  }

  /** 导入皮肤包（目录或 .zip 文件）；校验失败抛 SkinError，不影响已有包 */
  function importPack(sourcePath) {
    if (typeof sourcePath !== 'string' || !sourcePath.trim()) {
      throw new SkinError('未提供皮肤包路径');
    }
    const resolved = path.resolve(sourcePath);
    let stat;
    try {
      stat = fs.statSync(resolved);
    } catch (_error) {
      throw new SkinError('皮肤包路径不存在');
    }
    let validated;
    if (stat.isDirectory()) {
      validated = validateSkinPackFiles(collectDirectoryPack(resolved));
    } else if (stat.isFile()) {
      const ext = path.extname(resolved).toLowerCase();
      if (ext !== '.zip') {
        throw new SkinError('文件导入仅支持 .zip');
      }
      const buffer = fs.readFileSync(resolved);
      if (buffer.length > MAX_PACK_BYTES) {
        throw new SkinError(`皮肤包超过大小上限 ${MAX_PACK_BYTES} 字节`);
      }
      validated = validateSkinPackFiles(readZip(buffer));
    } else {
      throw new SkinError('皮肤包路径类型不支持');
    }

    const { manifest, files } = validated;
    if (isBuiltin(manifest.id)) {
      throw new SkinError(`皮肤 id 与内置皮肤冲突: ${manifest.id}`);
    }
    const target = path.join(baseDir, manifest.id);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // 覆盖同 id 旧导入包：校验已通过，仅在此刻删除旧目录
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
    }
    for (const file of files) {
      const dest = path.join(target, file.name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, file.data);
    }
    return entryFromDir(target, manifest.id, false);
  }

  /** 导出皮肤包为 zip（文件在包根目录，保证导出→重导入往返一致） */
  function exportPack(id, targetPath) {
    if (!find(id)) {
      throw new SkinError(`皮肤不存在: ${id}`);
    }
    const dir = skinDir(id);
    const files = [];
    function collect(current, prefix) {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          collect(full, prefix ? `${prefix}/${entry.name}` : entry.name);
        } else if (entry.isFile()) {
          files.push({
            name: prefix ? `${prefix}/${entry.name}` : entry.name,
            data: fs.readFileSync(full)
          });
        }
      }
    }
    collect(dir, '');
    if (files.length === 0) {
      throw new SkinError('皮肤目录为空，无法导出');
    }
    const zip = writeZip(files);
    let dest =
      targetPath && targetPath.trim()
        ? path.resolve(targetPath)
        : path.join(process.cwd(), `${id}-skin.zip`);
    if (!dest.toLowerCase().endsWith('.zip')) {
      dest += '.zip';
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, zip);
    return { id, path: dest };
  }

  /** 卸载导入的皮肤包（内置皮肤不可移除） */
  function remove(id) {
    if (!ID_PATTERN.test(id)) {
      throw new SkinError(`皮肤 id 非法: ${id}`);
    }
    if (isBuiltin(id)) {
      throw new SkinError('内置皮肤不可移除');
    }
    const target = path.join(baseDir, id);
    if (!fs.existsSync(target)) {
      throw new SkinError(`皮肤不存在: ${id}`);
    }
    fs.rmSync(target, { recursive: true, force: true });
    return { id };
  }

  /**
   * T-59：扫描 Codex 宠物目录并批量导入。
   * - 目录自身是宠物包（含 pet.json）时直接导入；否则递归扫描子目录；
   * - 跳过 node_modules/.git/隐藏目录与符号链接，不进入已识别宠物包内部；
   * - 逐包复用 importPack 校验，单个包失败不中断；
   * - 返回 { imported: [皮肤条目], failed: [{name, error}] }。
   * T-63：支持可选 onProgress({ index, total, name, error? }) 进度回调（按包触发，
   * 缺省不回调，现有调用与返回值不变）。
   */
  function scanCodexPetsDir(sourceDir, onProgress) {
    if (typeof sourceDir !== 'string' || !sourceDir.trim()) {
      throw new SkinError('未提供 Codex 宠物目录路径');
    }
    const resolved = path.resolve(sourceDir.trim());
    if (!fs.existsSync(resolved)) {
      throw new SkinError(`Codex 宠物目录不存在: ${resolved}`);
    }
    if (!fs.statSync(resolved).isDirectory()) {
      throw new SkinError('Codex 宠物目录路径不是文件夹');
    }
    const petDirs = [];
    const visited = new Set();

    function walk(dir) {
      let real;
      try {
        real = fs.realpathSync(dir);
      } catch (_error) {
        failed.push({
          name: path.basename(dir),
          error: `无法解析目录路径: ${dir}`
        });
        return;
      }
      if (visited.has(real)) {
        return;
      }
      visited.add(real);

      if (fs.existsSync(path.join(dir, PET_MANIFEST_NAME))) {
        petDirs.push(dir);
        // 已按宠物包处理，不再深入其内部目录
        return;
      }

      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (error) {
        failed.push({
          name: path.basename(dir),
          error: `读取目录失败: ${error && error.message ? error.message : error}`
        });
        return;
      }
      for (const entry of entries) {
        if (entry.isSymbolicLink() || !entry.isDirectory()) {
          continue;
        }
        const name = entry.name;
        if (name === 'node_modules' || name === '.git' || name.startsWith('.')) {
          continue;
        }
        walk(path.join(dir, name));
      }
    }

    walk(resolved);
    const imported = [];
    const failed = [];
    petDirs.forEach((dir, index) => {
      const name = path.basename(dir);
      let itemError = null;
      try {
        imported.push(importPack(dir));
      } catch (error) {
        itemError = error;
        failed.push({
          name,
          error: error && error.message ? error.message : String(error)
        });
      }
      if (typeof onProgress === 'function') {
        onProgress({
          index: index + 1,
          total: petDirs.length,
          name,
          error: itemError && itemError.message ? itemError.message : undefined
        });
      }
    });
    return { imported, failed };
  }

  return {
    list,
    find,
    importPack,
    exportPack,
    remove,
    scanCodexPetsDir,
    isBuiltin,
    baseDir,
    defaultsDir
  };
}

module.exports = {
  createSkinStore,
  validateSkinPackFiles,
  writeZip,
  readZip,
  SkinError,
  DEFAULT_SKIN_ID,
  SKIN_ID_MAX_LENGTH,
  MAX_PACK_BYTES,
  MAX_PACK_ENTRIES,
  MANIFEST_NAME,
  PET_MANIFEST_NAME,
  parseWebpSize,
  defaultCodexPetsDir,
  ALLOWED_EXTENSIONS
};

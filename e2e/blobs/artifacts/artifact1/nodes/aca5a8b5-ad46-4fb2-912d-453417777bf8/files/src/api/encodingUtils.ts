/**
 * Encoding Detection Utilities
 * 
 * Uses jschardet to automatically detect file encoding and properly decode
 * text files that may use non-UTF-8 encodings (e.g., GBK, Big5, Shift-JIS).
 */
import jschardet from 'jschardet';

export interface EncodingResult {
  content: string;
  detectedEncoding: string;
  confidence: number;
}

/**
 * 编码名称映射表
 * 将 jschardet 返回的编码名称映射到 TextDecoder 支持的编码名称
 */
const ENCODING_MAP: Record<string, string> = {
  'GB2312': 'gbk',
  'GB18030': 'gb18030',
  'Big5': 'big5',
  'EUC-JP': 'euc-jp',
  'SHIFT_JIS': 'shift-jis',
  'Shift_JIS': 'shift-jis',
  'EUC-KR': 'euc-kr',
  'ISO-8859-1': 'iso-8859-1',
  'ISO-8859-2': 'iso-8859-2',
  'windows-1250': 'windows-1250',
  'windows-1251': 'windows-1251',
  'windows-1252': 'windows-1252',
  'windows-1253': 'windows-1253',
  'windows-1254': 'windows-1254',
  'windows-1255': 'windows-1255',
  'windows-1256': 'windows-1256',
  'KOI8-R': 'koi8-r',
  'UTF-8': 'utf-8',
  'UTF-16BE': 'utf-16be',
  'UTF-16LE': 'utf-16le',
  'ascii': 'utf-8', // ASCII 可以用 UTF-8 解码
};

/**
 * 将 jschardet 编码名称映射为 TextDecoder 支持的编码
 */
function mapEncoding(encoding: string): string {
  // 优先查找精确匹配
  if (ENCODING_MAP[encoding]) {
    return ENCODING_MAP[encoding];
  }
  
  // 尝试大小写不敏感匹配
  const upperEncoding = encoding.toUpperCase();
  for (const [key, value] of Object.entries(ENCODING_MAP)) {
    if (key.toUpperCase() === upperEncoding) {
      return value;
    }
  }
  
  // 默认返回小写版本
  return encoding.toLowerCase();
}

/**
 * 使用 FileReader.readAsBinaryString 读取文件
 * 用于 jschardet 编码检测
 */
function readAsBinaryString(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = () => reject(new Error('Failed to read file as binary string'));
    reader.readAsBinaryString(file);
  });
}

/**
 * 读取文件并自动检测编码
 * 
 * @param file - 要读取的文件
 * @returns 包含解码后内容、检测到的编码和置信度的对象
 */
export async function readFileWithEncoding(file: File): Promise<EncodingResult> {
  // 1. 先用 binary string 读取以检测编码
  const binaryString = await readAsBinaryString(file);
  const detected = jschardet.detect(binaryString);
  
  // 2. 获取映射后的编码名称
  const encoding = mapEncoding(detected.encoding || 'utf-8');
  
  // 3. 使用 ArrayBuffer + TextDecoder 以正确的编码解码
  const arrayBuffer = await file.arrayBuffer();
  
  let content: string;
  try {
    const decoder = new TextDecoder(encoding);
    content = decoder.decode(arrayBuffer);
  } catch {
    // 如果指定的编码不支持，回退到 UTF-8
    console.warn(`Encoding "${encoding}" not supported, falling back to UTF-8`);
    const decoder = new TextDecoder('utf-8');
    content = decoder.decode(arrayBuffer);
  }
  
  return {
    content,
    detectedEncoding: detected.encoding || 'unknown',
    confidence: detected.confidence || 0
  };
}

/**
 * 使用指定编码重新解码文件
 * 
 * @param file - 要读取的文件
 * @param encoding - 要使用的编码
 * @returns 解码后的内容
 */
export async function readFileWithSpecificEncoding(file: File, encoding: string): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const mappedEncoding = mapEncoding(encoding);
  const decoder = new TextDecoder(mappedEncoding);
  return decoder.decode(arrayBuffer);
}

import i18next from 'i18next';

/**
 * 常用编码列表（用于手动选择）
 * Labels are i18n'd via common namespace.
 */
export function getCommonEncodings(): Array<{ value: string; label: string }> {
  return [
    { value: 'utf-8', label: 'UTF-8' },
    { value: 'gbk', label: `GBK (${i18next.t('common:encoding.simplifiedChinese')})` },
    { value: 'gb18030', label: `GB18030 (${i18next.t('common:encoding.chinese')})` },
    { value: 'big5', label: `Big5 (${i18next.t('common:encoding.traditionalChinese')})` },
    { value: 'shift-jis', label: `Shift-JIS (${i18next.t('common:encoding.japanese')})` },
    { value: 'euc-jp', label: `EUC-JP (${i18next.t('common:encoding.japanese')})` },
    { value: 'euc-kr', label: `EUC-KR (${i18next.t('common:encoding.korean')})` },
    { value: 'iso-8859-1', label: `ISO-8859-1 (${i18next.t('common:encoding.westernEuropean')})` },
    { value: 'windows-1252', label: `Windows-1252 (${i18next.t('common:encoding.westernEuropean')})` },
  ];
}

/** @deprecated Use getCommonEncodings() instead for i18n support */
export const COMMON_ENCODINGS = [
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'gbk', label: 'GBK (简体中文)' },
  { value: 'gb18030', label: 'GB18030 (中文)' },
  { value: 'big5', label: 'Big5 (繁体中文)' },
  { value: 'shift-jis', label: 'Shift-JIS (日语)' },
  { value: 'euc-jp', label: 'EUC-JP (日语)' },
  { value: 'euc-kr', label: 'EUC-KR (韩语)' },
  { value: 'iso-8859-1', label: 'ISO-8859-1 (西欧)' },
  { value: 'windows-1252', label: 'Windows-1252 (西欧)' },
];

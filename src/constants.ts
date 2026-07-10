// ============================================================
// Project Constants — shared configuration
// ============================================================

/** Predefined book categories for directory grouping and graph coloring */
export const BOOK_CATEGORIES = [
  '文学', '科幻', '推理悬疑', '历史', '哲学',
  '心理学', '社会学', '经济学', '管理学',
  '编程', '人工智能', '数学', '物理学', '生物学',
  '医学', '法律', '政治', '教育',
  '艺术', '设计', '传记', '商业', '科普', '宗教', '技术',
] as const;

export type BookCategory = typeof BOOK_CATEGORIES[number];

/** Default notes folder */
export const DEFAULT_NOTES_FOLDER = '📚图书库';


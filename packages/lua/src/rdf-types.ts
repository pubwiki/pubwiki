/**
 * RDF Triple - 基础三元组结构
 */
export interface Triple {
  subject: string
  predicate: string
  object: any  // 可以是字符串、数字、布尔值、对象等
}

/**
 * 三元组查询模式
 * 任何字段为 undefined 表示通配符
 */
export interface TriplePattern {
  subject?: string
  predicate?: string
  object?: any
}

/**
 * RDF 存储接口
 * 由调用者实现，pubwiki-lua 只负责桥接
 * 所有方法都是异步的
 */
export interface RDFStore {
  /**
   * 插入一个三元组
   */
  insert(subject: string, predicate: string, object: any): Promise<void>
  
  /**
   * 删除三元组
   * 如果 object 未指定，删除所有匹配 subject+predicate 的三元组
   */
  delete(subject: string, predicate: string, object?: any): Promise<void>
  
  /**
   * 查询三元组
   * 支持模式匹配，未指定的字段作为通配符
   */
  query(pattern: TriplePattern): Promise<Triple[]>
  
  /**
   * 批量插入（可选优化）
   */
  batchInsert?(triples: Triple[]): Promise<void>
  
  /**
   * 批量删除（可选优化）
   */
  batchDelete?(patterns: TriplePattern[]): Promise<void>
  
  /**
   * SPARQL 查询（可选）
   * 返回异步迭代器，支持流式获取结果
   * 每个结果是一个变量绑定的对象，例如：{ ?x: "value1", ?y: "value2" }
   */
  sparqlQuery?(sparql: string): AsyncIterableIterator<Record<string, any>>
  
  /**
   * 事务支持（可选）
   */
  transaction?<T>(callback: () => T | Promise<T>): Promise<T>
}

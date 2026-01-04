/// <reference types="vite/client" />

// 声明 ?raw 导入的类型
declare module '*.sql?raw' {
  const content: string;
  export default content;
}

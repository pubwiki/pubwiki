// Declare SQL files as text modules (imported via wrangler rules)
declare module '*.sql' {
  const content: string;
  export default content;
}

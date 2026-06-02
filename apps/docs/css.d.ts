// Ambient declaration for side-effect CSS imports (e.g. import './theme.css').
// TypeScript 6 no longer infers a type for these without an explicit module decl.
declare module '*.css';

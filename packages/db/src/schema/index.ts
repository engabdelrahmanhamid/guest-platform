// Tables follow the approved architecture (docs/architecture.md). Rules drizzle cannot
// express (triggers, append-only guards, seed rows) live in reviewed SQL migrations.
export * from './enums';
export * from './identity';
export * from './workspaces';
export * from './events';
export * from './platform';
export * from './guests';

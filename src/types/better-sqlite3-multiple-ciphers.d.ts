declare module 'better-sqlite3-multiple-ciphers' {
  namespace Database {
    interface RunResult {
      changes: number;
      lastInsertRowid: number | bigint;
    }

    interface Statement {
      get(...params: unknown[]): unknown;
      all(...params: unknown[]): unknown[];
      run(...params: unknown[]): RunResult;
    }

    interface Database {
      pragma(source: string): unknown;
      exec(source: string): void;
      prepare(source: string): Statement;
      transaction<T extends (...args: unknown[]) => unknown>(fn: T): T;
    }
  }

  const Database: {
    new(filename: string): Database.Database;
  };

  export = Database;
}

// Debe importarse el primero: `@/db` lanza si no hay DATABASE_URL. neon() no conecta al importar,
// así que basta una URL ficticia; ningún test hace consultas.
process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test?sslmode=disable";

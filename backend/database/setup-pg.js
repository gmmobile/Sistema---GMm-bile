require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function setup() {
  const client = await pool.connect();
  try {
    console.log('🔌 Conectado ao PostgreSQL (Neon)...');

    // Executa o schema
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await client.query(schema);
    console.log('✅ Schema criado com sucesso!');

    // Usuário admin padrão
    const { rows } = await client.query("SELECT id FROM usuarios WHERE email = 'admin@sistema.com'");
    if (rows.length === 0) {
      const senhaHash = bcrypt.hashSync('admin123', 10);
      await client.query(
        `INSERT INTO usuarios (nome, email, senha_hash, perfil) VALUES ($1, $2, $3, $4)`,
        ['Administrador', 'admin@sistema.com', senhaHash, 'gestor']
      );
      console.log('👤 Usuário padrão criado: admin@sistema.com / admin123');

      // Categorias financeiras padrão
      const cats = [
        ['Venda de Móveis Planejados', 'receita', '#22c55e'],
        ['Serviço de Instalação', 'receita', '#16a34a'],
        ['Assistência Técnica', 'receita', '#15803d'],
        ['Outros (receita)', 'receita', '#4ade80'],
        ['Compra de Materiais', 'despesa', '#ef4444'],
        ['Mão de Obra', 'despesa', '#dc2626'],
        ['Aluguel', 'despesa', '#f97316'],
        ['Salários', 'despesa', '#ea580c'],
        ['Marketing', 'despesa', '#a855f7'],
        ['Impostos', 'despesa', '#7c3aed'],
        ['Outros (despesa)', 'despesa', '#94a3b8'],
      ];
      for (const [nome, tipo, cor] of cats) {
        await client.query(
          'INSERT INTO categorias (nome, tipo, cor) VALUES ($1, $2, $3)',
          [nome, tipo, cor]
        );
      }
      console.log('📂 Categorias financeiras criadas!');

      // Conta padrão
      await client.query(
        `INSERT INTO contas_correntes (nome, tipo, saldo_inicial, cor) VALUES ('Caixa Principal', 'caixa', 0, '#6366f1')`
      );
      console.log('🏦 Conta corrente padrão criada!');

      // Configurações padrão
      await client.query(
        `INSERT INTO configuracoes_loja (id, nome_empresa) VALUES (1, 'GM MÓBILE') ON CONFLICT DO NOTHING`
      );
    } else {
      console.log('ℹ️  Usuário admin já existe — dados padrão não recriados.');
    }

    console.log('\n🎉 Setup concluído com sucesso!');
    console.log('Acesso: admin@sistema.com / admin123\n');
  } catch (err) {
    console.error('❌ Erro no setup:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

setup().catch(() => process.exit(1));

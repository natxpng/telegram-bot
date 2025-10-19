// notion.js
require('dotenv').config();
const { Client } = require("@notionhq/client");

console.log(`[DIAGNÓSTICO] Versão do Node.js em execução: ${process.version}`);
try {
  const notionClientPath = require.resolve('@notionhq/client');
  console.log(`[DIAGNÓSTICO] Pacote @notionhq/client encontrado em: ${notionClientPath}`);
} catch (e) {
  console.error('[DIAGNÓSTICO] ERRO: Pacote @notionhq/client não foi encontrado!');
}
// Validação de variáveis de ambiente
if (!process.env.NOTION_API_KEY || !process.env.NOTION_DATABASE_ID) {
  console.error("[NOTION] ERRO: NOTION_API_KEY ou NOTION_DATABASE_ID não estão definidos no seu arquivo .env!");
  process.exit(1); // Encerra a aplicação se as chaves não existirem
}

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

console.log('[NOTION] Client Notion instanciado com sucesso.');

// --- FUNÇÕES DE ESCRITA ---

/**
 * Salva os dados iniciais do usuário (onboarding) no Notion.
 */
async function salvarTriagemNotion({ chatId, nome, renda, fixos, variaveis, poupanca }) {
  console.log('[salvarTriagemNotion] Dados:', { chatId, nome, renda, fixos, variaveis, poupanca });
  await notion.pages.create({
    parent: { database_id: DATABASE_ID },
    properties: {
      "Nome do Usuário": { title: [{ text: { content: nome } }] },
      "Telegram User ID": { number: chatId },
      "Renda Mensal": { number: renda },
      "Gastos Fixos": { number: fixos },
      "Gastos Variáveis": { number: variaveis },
      "Meta de Poupança": { number: poupanca }
    }
  });
}

/**
 * Salva uma nova transação de gasto no Notion.
 * (Campos extras foram removidos para corresponder ao que 'gastos.js' envia)
 */
async function salvarGastoNotion({ chatId, nome, data, descricao, valor, tipoPagamento, categoria }) {
  console.log('[salvarGastoNotion] Dados:', { chatId, nome, data, descricao, valor, tipoPagamento, categoria });
  await notion.pages.create({
    parent: { database_id: DATABASE_ID },
    properties: {
      "Nome do Usuário": { title: [{ text: { content: nome || '' } }] },
      "Telegram User ID": { number: chatId },
      "Data do Gasto": { date: { start: data } },
      "Descrição": { rich_text: [{ text: { content: descricao || '' } }] },
      "Valor": { number: valor },
      "Tipo de Pagamento": { select: { name: tipoPagamento || 'Outro' } },
      "Categoria": { select: { name: categoria || 'Outro' } }
    }
  });
}

// --- FUNÇÕES DE LEITURA (CORRIGIDAS) ---

/**
 * Busca a página de perfil de um usuário específico.
 */
async function buscarDadosUsuarioNotion(chatId) {
  // CORREÇÃO: Removemos o 'chatId = CHAT_ID_FIXO;'
  const response = await notion.databases.query({
    database_id: DATABASE_ID,
    filter: {
      and: [
        {
          property: 'Telegram User ID',
          number: { equals: chatId }
        },
        { // OTIMIZAÇÃO: Garante que estamos pegando a página de perfil (que tem renda), não um gasto.
          property: 'Renda Mensal',
          number: { is_not_empty: true }
        }
      ]
    }
  });
  return response.results[0]?.properties || null;
}

/**
 * Busca todos os gastos de um usuário e agrupa os totais por categoria.
 */
async function buscarGastosPorCategoria(chatId) {
  // CORREÇÃO: Removemos o 'chatId = CHAT_ID_FIXO;'
  const response = await notion.databases.query({
    database_id: DATABASE_ID,
    filter: {
      and: [
        {
          property: 'Telegram User ID',
          number: { equals: chatId }
        },
        { // OTIMIZAÇÃO: Filtro para pegar apenas entradas de gastos (que têm valor), não o perfil.
          property: 'Valor',
          number: { is_not_empty: true }
        }
      ]
    }
  });

  const gastos = response.results;
  const categorias = {};

  for (const gasto of gastos) {
    const props = gasto.properties;
    let categoria = props['Categoria']?.select?.name?.trim() || 'Outro';
    const valor = props['Valor']?.number || 0;
    categorias[categoria] = (categorias[categoria] || 0) + valor;
  }
  
  return categorias;
}

/**
 * Busca uma lista detalhada de todas as transações de gastos de um usuário.
 */
async function buscarGastosDetalhados(chatId) {
  // CORREÇÃO: Removemos o 'chatId = CHAT_ID_FIXO;'
  const response = await notion.databases.query({
    database_id: DATABASE_ID,
    filter: {
      and: [
        {
          property: 'Telegram User ID',
          number: { equals: chatId }
        },
        { // OTIMIZAÇÃO: Filtro para pegar apenas entradas de gastos.
          property: 'Valor', 
          number: { is_not_empty: true }
        }
      ]
    },
    sorts: [ // OTIMIZAÇÃO: Ordena os gastos do mais recente para o mais antigo (bom para a IA).
      {
        property: 'Data do Gasto',
        direction: 'descending'
      }
    ]
  });

  // Extrai e formata os dados relevantes
  return response.results.map(gasto => {
    const props = gasto.properties;
    return {
      descricao: props['Descrição']?.rich_text?.[0]?.text?.content || '',
      valor: props['Valor']?.number || 0,
      tipoPagamento: props['Tipo de Pagamento']?.select?.name || 'Outro',
      categoria: props['Categoria']?.select?.name || 'Outro',
      data: props['Data do Gasto']?.date?.start || ''
    };
  });
}

// (Função 'atualizarDadoNotion' mantida caso você a use no futuro)
async function atualizarDadoNotion(chatId, campo, valor) {
  const response = await notion.databases.query({
    database_id: DATABASE_ID,
    filter: {
      property: 'Telegram User ID',
      number: { equals: chatId }
    }
  });
  const page = response.results[0];
  if (!page) throw new Error('Usuário não encontrado no Notion para atualizar.');
  
  await notion.pages.update({
    page_id: page.id,
    properties: {
      [campo]: isNaN(Number(valor)) ? { rich_text: [{ text: { content: valor } }] } : { number: Number(valor) }
    }
  });
}

module.exports = {
  salvarTriagemNotion,
  atualizarDadoNotion,
  buscarDadosUsuarioNotion,
  salvarGastoNotion,
  buscarGastosDetalhados,
  buscarGastosPorCategoria
};
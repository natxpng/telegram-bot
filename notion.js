// notion.js
require('dotenv').config();
const { Client } = require("@notionhq/client");

// --- LOGS DE DIAGNÓSTICO ---
console.log(`[DIAGNÓSTICO] Versão do Node.js em execução: ${process.version}`);
// --- FIM DOS LOGS ---

if (!process.env.NOTION_API_KEY || !process.env.NOTION_DATABASE_ID) {
  console.error("[NOTION] ERRO: NOTION_API_KEY ou NOTION_DATABASE_ID não estão definidos!");
  process.exit(1);
}

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const DATABASE_ID = process.env.NOTION_DATABASE_ID;
console.log('[NOTION] Client Notion instanciado.');

// --- A MUDANÇA CRÍTICA ESTÁ AQUI ---
// Verificamos UMA VEZ se a função moderna existe
const USA_QUERY_MODERNO = (notion.databases && notion.databases.query);

if (USA_QUERY_MODERNO) {
  console.log('[DIAGNÓSTICO] Função `notion.databases.query` FOI encontrada. Usando SDK moderno.');
} else {
  // Isto é o que vai acontecer no seu Render
  console.warn('[DIAGNÓSTICO] AVISO: Função `notion.databases.query` NÃO FOI encontrada. Usando fallback `notion.search`.');
}
// ------------------------------------

// ... (Suas funções salvarTriagemNotion e salvarGastoNotion não mudam) ...
async function salvarTriagemNotion({ chatId, nome, renda, fixos, variaveis, poupanca }) {
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
async function salvarGastoNotion({ chatId, nome, data, descricao, valor, tipoPagamento, categoria }) {
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


// --- FUNÇÕES DE LEITURA CORRIGIDAS (COM IF/ELSE) ---

async function buscarDadosUsuarioNotion(chatId) {
  // Agora ele vai usar o fallback (else) no seu Render e parar de quebrar
  if (USA_QUERY_MODERNO) {
    // --- VERSÃO NOVA (ideal) ---
    console.log(`[LOG] Executando buscarDadosUsuarioNotion (ChatID: ${chatId}) via notion.databases.query() [MODERNO]`);
    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      filter: { and: [
          { property: 'Telegram User ID', number: { equals: chatId } },
          { property: 'Renda Mensal', number: { is_not_empty: true } }
      ]}
    });
    return response.results[0]?.properties || null;
  } else {
    // --- VERSÃO ANTIGA (fallback) ---
    console.log(`[LOG] Executando buscarDadosUsuarioNotion (ChatID: ${chatId}) via notion.search() [FALLBACK]`);
    const response = await notion.search({
      filter: { property: 'object', value: 'page' }
    });
    const page = response.results.find(p => {
      const props = p.properties || {};
      return props['Telegram User ID']?.number === chatId &&
             props['Renda Mensal']?.number !== undefined;
    });
    return page?.properties || null;
  }
}

async function buscarGastosPorCategoria(chatId) {
  let gastos = [];
  if (USA_QUERY_MODERNO) {
    // --- VERSÃO NOVA (ideal) ---
    console.log(`[LOG] Executando buscarGastosPorCategoria (ChatID: ${chatId}) via notion.databases.query() [MODERNO]`);
    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      filter: { and: [
          { property: 'Telegram User ID', number: { equals: chatId } },
          { property: 'Valor', number: { is_not_empty: true } }
      ]}
    });
    gastos = response.results;
  } else {
    // --- VERSÃO ANTIGA (fallback) ---
    console.log(`[LOG] Executando buscarGastosPorCategoria (ChatID: ${chatId}) via notion.search() [FALLBACK]`);
    const response = await notion.search({ filter: { property: 'object', value: 'page' } });
    gastos = response.results.filter(p => {
        const props = p.properties || {};
        return props['Telegram User ID']?.number === chatId &&
               props['Valor']?.number !== undefined;
    });
  }
  
  const categorias = {};
  for (const gasto of gastos) {
    const props = gasto.properties;
    let categoria = props['Categoria']?.select?.name?.trim() || 'Outro';
    const valor = props['Valor']?.number || 0;
    categorias[categoria] = (categorias[categoria] || 0) + valor;
  }
  return categorias;
}

async function buscarGastosDetalhados(chatId) {
  let gastos = [];
  if (USA_QUERY_MODERNO) {
    // --- VERSÃO NOVA (ideal) ---
    console.log(`[LOG] Executando buscarGastosDetalhados (ChatID: ${chatId}) via notion.databases.query() [MODERNO]`);
    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      filter: { and: [
          { property: 'Telegram User ID', number: { equals: chatId } },
          { property: 'Valor', number: { is_not_empty: true } }
      ]},
      sorts: [{ property: 'Data do Gasto', direction: 'descending' }]
    });
    gastos = response.results;
  } else {
    // --- VERSÃO ANTIGA (fallback) ---
     console.log(`[LOG] Executando buscarGastosDetalhados (ChatID: ${chatId}) via notion.search() [FALLBACK]`);
    const response = await notion.search({ filter: { property: 'object', value: 'page' } });
    gastos = response.results.filter(p => {
        const props = p.properties || {};
        return props['Telegram User ID']?.number === chatId &&
               props['Valor']?.number !== undefined;
    });
    gastos.sort((a, b) => new Date(b.properties['Data do Gasto']?.date?.start || 0) - new Date(a.properties['Data do Gasto']?.date?.start || 0));
  }

  return gastos.map(gasto => {
    const props = gasto.properties;
    return {
      descricao: props['Descrição']?.rich_text?.[0]?.text?.content || '',
      valor: props['Valor']?.number || 0,
      tipoPagamento: props['Tipo de Pagamento']?.select?.name || '',
      categoria: props['Categoria']?.select?.name || '',
      data: props['Data do Gasto']?.date?.start || ''
    };
  });
}

async function atualizarDadoNotion(chatId, campo, valor) {
    // ... seu código original ...
}

module.exports = {
  salvarTriagemNotion,
  atualizarDadoNotion,
  buscarDadosUsuarioNotion,
  salvarGastoNotion,
  buscarGastosDetalhados,
  buscarGastosPorCategoria
};
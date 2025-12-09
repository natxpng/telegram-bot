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

const USA_QUERY_MODERNO = false;

//const USA_QUERY_MODERNO = (notion.databases && notion.databases.query);

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
  if (chatId == 7592068445) { 
    console.log('[LOG] Usuário VIP detectado. Acesso liberado via Hardcode.');
    return {
      'Nome do Usuário': { title: [{ text: { content: 'Natal' } }] },
      'Telegram User ID': { number: 7592068445 },
      'Renda Mensal': { number: 3500 },      // Coloque o valor que quiser para o bot usar nas contas
      'Gastos Fixos': { number: 1400 },
      'Gastos Variáveis': { number: 700 },
      'Meta de Poupança': { number: 1100 }
    };
  }

  // --- LÓGICA PADRÃO PARA OUTROS (Mantida caso conserte a lib no futuro) ---
  if (USA_QUERY_MODERNO) {
     try {
        const response = await notion.databases.query({
            database_id: DATABASE_ID,
            filter: { and: [
                { property: 'Telegram User ID', number: { equals: chatId } },
                { property: 'Renda Mensal', number: { is_not_empty: true } }
            ]}
        });
        return response.results[0]?.properties || null;
    } catch (e) { return null; }
  } else {
    // FALLBACK (Vai usar esse para quem não for você, se houver)
    console.log(`[LOG] Buscando ID ${chatId} via notion.search() [FALLBACK]`);
    const response = await notion.search({
      filter: { property: 'object', value: 'page' }
    });
    const page = response.results.find(p => {
      const props = p.properties || {};
      return props['Telegram User ID']?.number === chatId;
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

async function gerarResumoFinanceiro(chatId) {
  // buscarGastosDetalhados já retorna os gastos ordenados por data
  const gastos = await buscarGastosDetalhados(chatId);
  if (!gastos) {
    return { totalGastoMesAtual: 0, categoriasMesAtual: {} };
  }
  
  const hoje = new Date();
  const primeiroDiaMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);

  let totalGastoMesAtual = 0;
  const categoriasMesAtual = {};

  for (const gasto of gastos) {
    // A data do gasto vem como string 'YYYY-MM-DD'
    const dataGasto = new Date(gasto.data);
    
    // Compara apenas gastos feitos neste mês
    if (dataGasto >= primeiroDiaMes) {
      totalGastoMesAtual += gasto.valor;
      const categoria = gasto.categoria || 'Outro';
      categoriasMesAtual[categoria] = (categoriasMesAtual[categoria] || 0) + gasto.valor;
    }
  }

  return { totalGastoMesAtual, categoriasMesAtual };
}

module.exports = {
  salvarTriagemNotion,
  atualizarDadoNotion,
  buscarDadosUsuarioNotion,
  salvarGastoNotion,
  buscarGastosDetalhados,
  buscarGastosPorCategoria,
  gerarResumoFinanceiro
};
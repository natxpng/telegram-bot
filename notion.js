// notion.js
require('dotenv').config();
const { Client } = require("@notionhq/client");

if (!process.env.NOTION_API_KEY || !process.env.NOTION_DATABASE_ID) {
  console.error("[NOTION] ERRO: NOTION_API_KEY ou NOTION_DATABASE_ID não estão definidos!");
  process.exit(1);
}

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const DATABASE_ID = process.env.NOTION_DATABASE_ID;
console.log('[NOTION] Client Notion instanciado.');

// <-- MUDANÇA: Removido o CHAT_ID_FIXO que causava o bug principal.

/**
 * Salva os dados iniciais do usuário (onboarding) no Notion.
 */
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

/**
 * Busca a página de perfil de um usuário específico.
 */
async function buscarDadosUsuarioNotion(chatId) {
  // chatId = CHAT_ID_FIXO; // <-- REMOVIDO!
  
  if (!notion.databases.query) {
    // --- VERSÃO ANTIGA (fallback) ---
    console.log('[NOTION] Usando fallback notion.search() para buscarDadosUsuarioNotion');
    const response = await notion.search({
      filter: { property: 'object', value: 'page' }
    });
    const page = response.results.find(p => {
      const props = p.properties || {};
      return props['Telegram User ID']?.number === chatId &&
             props['Renda Mensal']?.number !== undefined; // Diferencia de um gasto
    });
    return page?.properties || null;
  } else {
    // --- VERSÃO NOVA (ideal) ---
    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      filter: {
        and: [
          { property: 'Telegram User ID', number: { equals: chatId } },
          { property: 'Renda Mensal', number: { is_not_empty: true } }
        ]
      }
    });
    return response.results[0]?.properties || null;
  }
}

async function buscarGastosPorCategoria(chatId) {
  // chatId = CHAT_ID_FIXO; // <-- REMOVIDO!
  let gastos = [];

  if (!notion.databases.query) {
    // --- VERSÃO ANTIGA (fallback) ---
    console.log('[NOTION] Usando fallback notion.search() para buscarGastosPorCategoria');
    const response = await notion.search({ filter: { property: 'object', value: 'page' } });
    gastos = response.results.filter(p => {
        const props = p.properties || {};
        return props['Telegram User ID']?.number === chatId &&
               props['Valor']?.number !== undefined; // Diferencia do perfil
    });
  } else {
    // --- VERSÃO NOVA (ideal) ---
    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      filter: {
        and: [
          { property: 'Telegram User ID', number: { equals: chatId } },
          { property: 'Valor', number: { is_not_empty: true } }
        ]
      }
    });
    gastos = response.results;
  }

  console.log('[buscarGastosPorCategoria] Gastos encontrados:', gastos.length);
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
  // chatId = CHAT_ID_FIXO; // <-- REMOVIDO!
  let gastos = [];

  if (!notion.databases.query) {
    // --- VERSÃO ANTIGA (fallback) ---
     console.log('[NOTION] Usando fallback notion.search() para buscarGastosDetalhados');
    const response = await notion.search({ filter: { property: 'object', value: 'page' } });
    gastos = response.results.filter(p => {
        const props = p.properties || {};
        return props['Telegram User ID']?.number === chatId &&
               props['Valor']?.number !== undefined;
    });
    // Ordenação manual (search não suporta sorts)
    gastos.sort((a, b) => {
        const dateA = new Date(a.properties['Data do Gasto']?.date?.start || 0);
        const dateB = new Date(b.properties['Data do Gasto']?.date?.start || 0);
        return dateB - dateA; // Mais recente primeiro
    });

  } else {
    // --- VERSÃO NOVA (ideal) ---
    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      filter: {
        and: [
          { property: 'Telegram User ID', number: { equals: chatId } },
          { property: 'Valor', number: { is_not_empty: true } }
        ]
      },
      sorts: [{ property: 'Data do Gasto', direction: 'descending' }]
    });
    gastos = response.results;
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

// Removi 'atualizarDadoNotion' e 'gerarGraficoBarrasGastos' que não estavam sendo usados
module.exports = {
  salvarTriagemNotion,
  // atualizarDadoNotion, // Descomente se for usar
  buscarDadosUsuarioNotion,
  salvarGastoNotion,
  // gerarGraficoBarrasGastos, // Descomente se for usar
  buscarGastosDetalhados,
  buscarGastosPorCategoria
};
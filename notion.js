// notion.js
require('dotenv').config();
const { Client } = require("@notionhq/client");

// Validação de variáveis de ambiente
if (!process.env.NOTION_API_KEY || !process.env.NOTION_DATABASE_ID) {
  console.error("[NOTION] ERRO: NOTION_API_KEY ou NOTION_DATABASE_ID não estão definidos no seu arquivo .env!");
  process.exit(1); // Encerra a aplicação se as chaves não existirem
}

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

console.log('[NOTION] Client Notion instanciado com sucesso.');

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
  const response = await notion.databases.query({
    database_id: DATABASE_ID,
    filter: {
      and: [
        {
          property: 'Telegram User ID',
          number: { equals: chatId }
        },
        { // <-- MUDANÇA: Garante que estamos pegando a página de perfil, não um gasto.
          property: 'Renda Mensal',
          number: { is_not_empty: true }
        }
      ]
    }
  });
  return response.results[0]?.properties || null;
}

/**
 * Salva uma nova transação de gasto no Notion.
 */
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
      // Outros campos como "Cartão de Crédito", "Parcelado?" podem ser adicionados aqui se necessário.
    }
  });
}

/**
 * Busca todos os gastos de um usuário e agrupa os totais por categoria.
 */
async function buscarGastosPorCategoria(chatId) {
  const response = await notion.databases.query({
    database_id: DATABASE_ID,
    filter: {
      and: [
        {
          property: 'Telegram User ID',
          number: { equals: chatId }
        },
        { // <-- MUDANÇA: Filtro para pegar apenas entradas de gastos, não a página de perfil.
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
  const response = await notion.databases.query({
    database_id: DATABASE_ID,
    filter: {
      and: [
        {
          property: 'Telegram User ID',
          number: { equals: chatId }
        },
        { // <-- MUDANÇA: Filtro para pegar apenas entradas de gastos.
          property: 'Valor', 
          number: { is_not_empty: true }
        }
      ]
    },
    sorts: [ // <-- MUDANÇA: Ordena os gastos do mais recente para o mais antigo.
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

// <-- MUDANÇA: As funções 'atualizarDadoNotion' e 'gerarGraficoBarrasGastos' foram removidas
// para simplificar o código, pois não estavam sendo usadas ou foram substituídas.

module.exports = {
  salvarTriagemNotion,
  buscarDadosUsuarioNotion,
  salvarGastoNotion,
  buscarGastosDetalhados,
  buscarGastosPorCategoria
};
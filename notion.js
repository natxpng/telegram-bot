// notion.js
require('dotenv').config();
const { Client } = require("@notionhq/client");
const notion = new Client({ auth: process.env.NOTION_API_KEY });
const axios = require('axios');

// Chat ID fixo para testes
const CHAT_ID_FIXO = 123456;

async function salvarTriagemNotion({ chatId, nome, renda, fixos, variaveis, poupanca }) {
  const databaseId = process.env.NOTION_DATABASE_ID;
  console.log('[salvarTriagemNotion] Dados:', { chatId, nome, renda, fixos, variaveis, poupanca });
  await notion.pages.create({
    parent: { database_id: databaseId },
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

async function atualizarDadoNotion(chatId, campo, valor) {
  const databaseId = process.env.NOTION_DATABASE_ID;
  // Busca página do usuário
  const response = await notion.databases.query({
    database_id: databaseId,
    filter: {
      property: 'Telegram User ID',
      number: { equals: chatId }
    }
  });
  const page = response.results[0];
  if (!page) throw new Error('Usuário não encontrado no Notion');
  // Atualiza campo
  await notion.pages.update({
    page_id: page.id,
    properties: {
      [campo]: isNaN(Number(valor)) ? { rich_text: [{ text: { content: valor } }] } : { number: Number(valor) }
    }
  });
}

async function buscarDadosUsuarioNotion(chatId) {
  chatId = CHAT_ID_FIXO; // Força uso do ID fixo
  const databaseId = process.env.NOTION_DATABASE_ID;
  // Alternativa para versões antigas do SDK
  if (!notion.databases.query) {
    // Busca todas páginas e filtra manualmente
    const response = await notion.search({
      filter: {
        property: 'object',
        value: 'page'
      }
    });
    const page = response.results.find(p => {
      const props = p.properties || {};
      return props['Telegram User ID']?.number === chatId;
    });
    return page?.properties || null;
  }
  // Versão nova do SDK
  const response = await notion.databases.query({
    database_id: databaseId,
    filter: {
      property: 'Telegram User ID',
      number: { equals: chatId }
    }
  });
  return response.results[0]?.properties || null;
}

async function salvarGastoNotion({ chatId, nome, data, descricao, valor, tipoPagamento, categoria, cartao, vencimentoFatura, parcelado, numParcelas, valorParcela, observacoes }) {
  const databaseId = process.env.NOTION_DATABASE_ID;
  console.log('[salvarGastoNotion] Dados:', { chatId, nome, data, descricao, valor, tipoPagamento, categoria, cartao, vencimentoFatura, parcelado, numParcelas, valorParcela, observacoes });
  await notion.pages.create({
    parent: { database_id: databaseId },
    properties: {
      "Nome do Usuário": { title: [{ text: { content: nome || '' } }] },
      "Telegram User ID": { number: chatId },
      "Data do Gasto": { date: { start: data } },
      "Descrição": { rich_text: [{ text: { content: descricao || '' } }] },
      "Valor": { number: valor },
      "Tipo de Pagamento": { select: { name: tipoPagamento || 'Outro' } },
      "Categoria": { select: { name: categoria || 'Outro' } },
      "Cartão de Crédito": cartao ? { select: { name: cartao } } : undefined,
      "Vencimento da Fatura": vencimentoFatura ? { date: { start: vencimentoFatura } } : undefined,
      "Parcelado?": { checkbox: !!parcelado },
      "Número de Parcelas": numParcelas ? { number: numParcelas } : undefined,
      "Valor da Parcela": valorParcela ? { number: valorParcela } : undefined,
      "Observações": observacoes ? { rich_text: [{ text: { content: observacoes } }] } : undefined
    }
  });
}

async function buscarGastosPorCategoria(chatId) {
  chatId = CHAT_ID_FIXO;
  const databaseId = process.env.NOTION_DATABASE_ID;
  let gastos = [];
  if (!notion.databases.query) {
    const response = await notion.search({ filter: { property: 'object', value: 'page' } });
    gastos = response.results.filter(p => p.properties?.['Telegram User ID']?.number === chatId);
  } else {
    const response = await notion.databases.query({
      database_id: databaseId,
      filter: { property: 'Telegram User ID', number: { equals: chatId } }
    });
    gastos = response.results;
  }
  console.log('[buscarGastosPorCategoria] Gastos encontrados:', gastos.length);
  // Agrupa por categoria
  const categorias = {};
  for (const gasto of gastos) {
    const props = gasto.properties;
    // Corrige leitura da categoria
    let categoria = props['Categoria']?.select?.name?.trim();
    if (!categoria || categoria === '') categoria = 'Outro';
    const valor = props['Valor']?.number || 0;
    categorias[categoria] = (categorias[categoria] || 0) + valor;
  }
  console.log('[buscarGastosPorCategoria] Categorias:', categorias);
  return categorias;
}

async function gerarGraficoBarrasGastos(chatId) {
  const categorias = await buscarGastosPorCategoria(chatId);
  const labels = Object.keys(categorias);
  const data = Object.values(categorias);
  const chartConfig = {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Gastos por Categoria', data }]
    }
  };
  const url = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
  // Baixa a imagem do gráfico
  const response = await axios.get(url, { responseType: 'arraybuffer' });
  return response.data; // Buffer da imagem PNG
}

async function buscarGastosDetalhados(chatId) {
  chatId = CHAT_ID_FIXO;
  const databaseId = process.env.NOTION_DATABASE_ID;
  let gastos = [];
  if (!notion.databases.query) {
    const response = await notion.search({ filter: { property: 'object', value: 'page' } });
    gastos = response.results.filter(p => p.properties?.['Telegram User ID']?.number === chatId);
  } else {
    const response = await notion.databases.query({
      database_id: databaseId,
      filter: { property: 'Telegram User ID', number: { equals: chatId } }
    });
    gastos = response.results;
  }
  // Extrai dados relevantes
  return gastos.map(gasto => {
    const props = gasto.properties;
    return {
      descricao: props['Descrição']?.rich_text?.[0]?.text?.content || '',
      valor: props['Valor']?.number || 0,
      tipoPagamento: props['Tipo de Pagamento']?.select?.name || '',
      categoria: props['Categoria']?.select?.name || '',
      cartao: props['Cartão de Crédito']?.select?.name || '',
      vencimentoFatura: props['Vencimento da Fatura']?.date?.start || '',
      parcelado: props['Parcelado?']?.checkbox || false,
      numParcelas: props['Número de Parcelas']?.number || 1,
      valorParcela: props['Valor da Parcela']?.number || 0,
      data: props['Data do Gasto']?.date?.start || '',
      observacoes: props['Observações']?.rich_text?.[0]?.text?.content || ''
    };
  });
}

module.exports = {
  salvarTriagemNotion,
  atualizarDadoNotion,
  buscarDadosUsuarioNotion,
  salvarGastoNotion,
  gerarGraficoBarrasGastos,
  buscarGastosDetalhados,
  buscarGastosPorCategoria // <-- exportação corrigida
};
require('dotenv').config();
const axios = require('axios');
const { buscarGastosPorCategoria } = require('./notion');

async function gerarGraficoBonito(chatId) {
  const categorias = await buscarGastosPorCategoria(chatId);
  const labels = Object.keys(categorias);
  const data = Object.values(categorias);

  const chartConfig = {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Gastos por Categoria',
        data,
        backgroundColor: [
          '#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc949', '#af7aa1', '#ff9da7', '#9c755f', '#bab0ab'
        ],
        borderRadius: 6,
        barPercentage: 0.7
      }]
    },
    options: {
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: 'Gastos por Categoria',
          font: { size: 18 }
        }
      },
      scales: {
        x: { title: { display: true, text: 'Categoria' } },
        y: { title: { display: true, text: 'Valor (R$)' }, beginAtZero: true }
      }
    }
  };

  const url = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
  const response = await axios.get(url, { responseType: 'arraybuffer' });
  return response.data;
}

module.exports = { gerarGraficoBonito };

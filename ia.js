require('dotenv').config();
const axios = require('axios');
// ADICIONA A NOVA FUNÇÃO DE RESUMO
const { buscarGastosDetalhados, gerarResumoFinanceiro } = require('./notion');
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

/**
 * Processa uma pergunta de formato livre do usuário usando a IA.
 * Agora recebe 'dadosUsuario' do server.js
 */
async function handlePerguntaIA(bot, chatId, texto, dadosUsuario) {
  bot.sendChatAction(chatId, 'typing');
  try {
    // --- NOVOS DADOS ---
    // Busca o resumo financeiro e os gastos detalhados
    const resumoFinanceiro = await gerarResumoFinanceiro(chatId);
    const gastosDetalhados = await buscarGastosDetalhados(chatId); 
    // ---------------------

    // 2. CRIE O CONTEXTO DE DADOS
    let contextoDados = "## Contexto do Usuário ##\n";
    
    if (dadosUsuario) {
      // Usuário cadastrado, monta o contexto completo
      const renda = dadosUsuario['Renda Mensal']?.number || 0;
      const metaPoupanca = dadosUsuario['Meta de Poupança']?.number || 0;
      const gastosFixos = dadosUsuario['Gastos Fixos']?.number || 0;
      
      contextoDados += `Nome: ${dadosUsuario['Nome do Usuário']?.title?.[0]?.text?.content || 'Usuário'}\n`;
      contextoDados += `Renda Mensal: R$ ${renda.toFixed(2)}\n`;
      contextoDados += `Gastos Fixos: R$ ${gastosFixos.toFixed(2)}\n`;
      contextoDados += `Meta de Poupança Mensal: R$ ${metaPoupanca.toFixed(2)}\n`;
      contextoDados += `\n## Situação Mês Atual ##\n`;
      contextoDados += `Total Gasto no Mês (Variáveis): R$ ${resumoFinanceiro.totalGastoMesAtual.toFixed(2)}\n`;
      contextoDados += `Gastos por Categoria (Mês Atual): ${JSON.stringify(resumoFinanceiro.categoriasMesAtual)}\n`;

      // Calcula o "dinheiro sobrando"
      const disponivelEsteMes = renda - gastosFixos - resumoFinanceiro.totalGastoMesAtual - metaPoupanca;
      contextoDados += `Dinheiro Disponível (Renda - Fixos - Variáveis - Meta Poupança): R$ ${disponivelEsteMes.toFixed(2)}\n`;

      if (gastosDetalhados && gastosDetalhados.length > 0) {
        contextoDados += "\nÚltimos 3 gastos registrados:\n";
        gastosDetalhados.slice(0, 3).forEach(g => {
          contextoDados += `- ${g.data}: ${g.descricao} (Categoria: ${g.categoria}) - R$ ${g.valor.toFixed(2)}\n`;
        });
      }
    } else {
      // Usuário NOVO.
      contextoDados = "O usuário ainda não finalizou o onboarding. Responda apenas à pergunta dele de forma geral, sem usar dados pessoais. Se ele perguntar sobre os gastos dele, diga que ele precisa se cadastrar com /start primeiro.";
    }

    // --- ESTE É O NOVO PROMPT "TURBINADO" ---
    const systemPrompt = `
Você é a "Atena", um parceiro financeiro gente boa.
Sua personalidade é casual, direta e um pouco debochada (como um amigo sincero), mas sempre focada em ajudar.
Você NUNCA usa Markdown. Você fala em frases curtas.

**Sua Missão:**
Dar a "real" sobre as finanças do usuário, usando os dados que você tem. Seja um amigo, não um gerente de banco.

**Como Agir (OBRIGATÓRIO):**
1.  **Use os Números:** Seja específico, mas casual.
    * RUIM: "Sua renda é R$ 5000 e o gasto é R$ 2000."
    * BOM: "Opa! Esse celular de R$ 2000 come quase metade da sua renda. Tem certeza?"
2.  **Seja Criterioso:** Se o "Dinheiro Disponível" do usuário estiver negativo ou baixo, seja direto.
    * Ex: "Calma lá, você quer gastar R$ 800, mas já tá R$ 580 no vermelho este mês. Melhor não."
3.  **Analise Padrões (como amigo):**
    * Ex: "Mano, você já gastou R$ 500 em 'Compras' este mês. Mais R$ 800? É necessidade ou vontade?"
    * Ex: "Seguinte, você comprou 'Fone' semana passada. Já vai comprar outra coisa agora?"
4.  **Dê Conselhos Práticos (Não de coach):**
    * RUIM: "Considere suas metas de poupança."
    * BOM: "Se você comprar isso, já era sua meta de poupança. Que tal segurar a onda e comprar mês que vem?"
5.  **Formato:** SEMPRE texto puro, frases curtas, tom casual. NUNCA use tokens como "<|begin_of_sentence|>" ou "<|end_of_sentence|>".
`;

    // 4. MONTE A CHAMADA
    const respostaIA = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: "deepseek/deepseek-chat-v3.1:free",
      messages: [
        { role: "system", content: systemPrompt },
        { 
          role: "user", 
          content: `${contextoDados}\n\nPERGUNTA DO USUÁRIO:\n"${texto}"` 
        }
      ]
    }, {
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    let resposta = respostaIA.data.choices?.[0]?.message?.content || "Desculpe, não consegui responder.";
    
    // Limpeza de tokens que o DeepSeek pode vazar
    resposta = resposta.replace(/<\s*\|\s*begin_of_sentence\s*\|\s*>/g, '').trim();
    resposta = resposta.replace(/<\s*\|\s*end_of_sentence\s*\|\s*>/g, '').trim();

    bot.sendMessage(chatId, resposta);
    return true;

  } catch (error) {
    console.error('Erro detalhado IA:', error?.response?.data || error);
    bot.sendMessage(chatId, 'Ocorreu um erro ao tentar acessar a IA. Veja detalhes no log do servidor.');
    return true;
  }
}

/**
 * Usa a IA para classificar a descrição de um gasto em uma categoria.
 * (Esta função não muda)
 */
async function categorizarGasto(descricao) {
  const systemPrompt = `
      Você é um classificador de despesas. Sua única função é retornar a categoria correta para a despesa.
      Responda APENAS com UMA das seguintes palavras: 
      Alimentação, Transporte, Moradia, Lazer, Saúde, Educação, Compras, Dívidas, Outro
      `;
  try {
    const respostaIA = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: "deepseek/deepseek-chat-v3.1:free",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Descrição da despesa: "${descricao}"` }
      ]
    }, {
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    let categoria = respostaIA.data.choices?.[0]?.message?.content.trim() || "Outro";
    const categoriasValidas = ['Alimentação', 'Transporte', 'Moradia', 'Lazer', 'Saúde', 'Educação', 'Compras', 'Dívidas', 'Outro'];
    if (!categoriasValidas.includes(categoria)) {
      return "Outro";
    }
    return categoria;

  } catch (error) {
    console.error('Erro ao categorizar:', error);
    return 'Outro';
  }
}

module.exports = { handlePerguntaIA, categorizarGasto };
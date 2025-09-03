import { Instagram } from './src/Instagram';
import { PostsDatabase } from './src/PostsDatabase';

async function exemploMonitoramentoComBanco() {
  const instagram = new Instagram({
    username: 'seu_usuario',
    password: 'sua_senha',
    headless: false
  });

  try {
    // Inicializa e faz login
    await instagram.init();
    await instagram.login();

    console.log('🚀 Iniciando monitoramento com salvamento no banco...');

    // Monitora posts de usuários específicos
    const postsColetados = await instagram.monitorNewPostsFromUsers({
      usernames: ['usuario1', 'usuario2', 'usuario3'],
      checkInterval: 30000, // 30 segundos
      maxExecutions: 3, // Apenas 3 execuções para teste
      onNewPosts: async (posts, executionCount, totalTime) => {
        console.log(`\n📊 Execução ${executionCount}: ${posts.length} novos posts encontrados`);
        console.log(`⏱️ Tempo total: ${Math.round(totalTime / 1000)}s`);
        
        if (posts.length > 0) {
          // Salva posts no banco de dados
          const resultado = await PostsDatabase.savePosts(posts, 'seu_usuario');
          console.log(`💾 Salvamento: ${resultado.saved} novos, ${resultado.duplicates} atualizados`);
          
          // Mostra estatísticas gerais
          const stats = await PostsDatabase.getStats('seu_usuario');
          console.log(`📈 Total no banco: ${stats.totalPosts} posts de ${stats.totalUsers} usuários`);
          console.log(`📊 Médias: ${stats.avgLikes} curtidas, ${stats.avgComments} comentários`);
        }
      }
    });

    console.log(`\n✅ Monitoramento concluído! Total de posts coletados: ${postsColetados.length}`);
    
    // Salva todos os posts coletados (caso não tenha sido feito no callback)
    if (postsColetados.length > 0) {
      const resultadoFinal = await PostsDatabase.savePosts(postsColetados, 'seu_usuario');
      console.log(`💾 Salvamento final: ${resultadoFinal.saved} novos, ${resultadoFinal.duplicates} atualizados`);
    }

    // Exemplos de consultas
    console.log('\n🔍 Exemplos de consultas:');
    
    // Posts de um usuário específico
    const postsUsuario = await PostsDatabase.getPostsByUsername('usuario1', 'seu_usuario');
    console.log(`📱 Posts de usuario1: ${postsUsuario.length}`);
    
    // Posts dos últimos 7 dias
    const seteDiasAtras = new Date();
    seteDiasAtras.setDate(seteDiasAtras.getDate() - 7);
    const postsRecentes = await PostsDatabase.getPostsByDateRange(
      seteDiasAtras.toISOString(),
      new Date().toISOString(),
      'seu_usuario'
    );
    console.log(`📅 Posts dos últimos 7 dias: ${postsRecentes.length}`);

  } catch (error: any) {
    console.error('❌ Erro:', error.message);
  } finally {
    await instagram.close();
  }
}

// Executa o exemplo
if (require.main === module) {
  exemploMonitoramentoComBanco()
    .then(() => {
      console.log('\n🎉 Exemplo concluído com sucesso!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Erro no exemplo:', error);
      process.exit(1);
    });
}

export { exemploMonitoramentoComBanco };
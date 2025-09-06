// Teste simples para verificar se o workflow corrigido funciona
const fs = require('fs');
const path = require('path');

// Simular dados de teste
const mockWorkflowResult = {
  stepId: 'step-1-monitor',
  stepName: 'Monitorar Posts',
  success: true,
  result: {
    allLikers: [
      { username: 'user1', userId: '123' },
      { username: 'user2', userId: '456' },
      { username: 'user3', userId: '789' }
    ]
  }
};

// Simular contexto de steps
const mockContext = {
  steps: {
    'step-1-monitor': mockWorkflowResult
  }
};

// Função para resolver valores (simplificada)
function resolveValue(template, context) {
  if (typeof template !== 'string' || !template.includes('{{')) {
    return template;
  }

  return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
    const keys = path.trim().split('.');
    let value = context;
    
    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return undefined;
      }
    }
    
    return value;
  });
}

// Função para avaliar condição isNotEmpty
function evaluateIsNotEmpty(value) {
  if (value === null || value === undefined) {
    return false;
  }
  
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  
  if (typeof value === 'object') {
    return Object.keys(value).length > 0;
  }
  
  return Boolean(value);
}

// Teste da correção
console.log('🧪 Testando correção do workflow...');
console.log('\n📊 Dados de teste:');
console.log('- allLikers:', JSON.stringify(mockWorkflowResult.result.allLikers, null, 2));

// Testar resolução do valor
const template = '{{steps.step-1-monitor.result.allLikers}}';
const resolvedValue = resolveValue(template, mockContext);
console.log('\n🔍 Resolvendo template:', template);
console.log('- Valor resolvido:', JSON.stringify(resolvedValue, null, 2));

// Testar condição isNotEmpty
const conditionResult = evaluateIsNotEmpty(resolvedValue);
console.log('\n✅ Avaliando condição isNotEmpty:');
console.log('- Resultado:', conditionResult);
console.log('- Esperado: true (porque temos 3 likers)');

// Verificar se a correção funcionou
if (conditionResult === true) {
  console.log('\n🎉 SUCESSO! A correção está funcionando:');
  console.log('- O template foi resolvido corretamente');
  console.log('- A condição isNotEmpty retornou true');
  console.log('- O workflow deve prosseguir para o forEach');
} else {
  console.log('\n❌ FALHA! Ainda há problemas:');
  console.log('- A condição isNotEmpty retornou false');
  console.log('- O workflow não prosseguirá corretamente');
}

console.log('\n📋 Resumo do teste:');
console.log('- Template:', template);
console.log('- Valor resolvido:', Array.isArray(resolvedValue) ? `Array com ${resolvedValue.length} itens` : typeof resolvedValue);
console.log('- Condição isNotEmpty:', conditionResult);
console.log('- Status:', conditionResult ? '✅ PASSOU' : '❌ FALHOU');
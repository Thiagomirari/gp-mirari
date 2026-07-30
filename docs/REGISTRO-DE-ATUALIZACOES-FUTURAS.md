# Registro de Atualizacoes Futuras - GP Mirari

Este documento serve como um local unico para registrar ideias, pendencias, problemas conhecidos e decisoes sobre futuras atualizacoes do GP Mirari.

Use este arquivo para planejar antes de implementar. Nada listado aqui deve ser executado automaticamente sem uma nova confirmacao.

## Como usar

- Adicione novas ideias em `Ideias e melhorias futuras`.
- Registre problemas em `Problemas conhecidos`.
- Use `Decisoes tomadas` para manter combinado o que foi decidido.
- Quando algo for aprovado para execucao, mova ou copie para `Fila de implementacao`.
- Depois de implementado, registre em `Historico de execucao`.

## Status sugeridos

- Ideia
- Em analise
- Aprovado
- Bloqueado
- Em desenvolvimento
- Concluido
- Cancelado

## Prioridades sugeridas

- Alta
- Media
- Baixa

---

## Ideias e melhorias futuras

### 1. Login com Google

Status: Em analise  
Prioridade: Alta  
Data de registro: 2026-07-27  

Contexto:
O login com Google ainda precisa ser validado com cuidado no ambiente hospedado.

Direcionamento futuro:
- Revisar configuracoes de redirecionamento no Supabase.
- Conferir callback configurado no Google Cloud.
- Validar se o retorno do Google chega com `code` ou `error`.
- Garantir que usuarios liberados pelo ADM consigam acessar.
- Garantir que usuarios nao liberados sejam bloqueados com mensagem clara.

Criterio de conclusao:
- Usuario com e-mail liberado pelo ADM entra com Google.
- Usuario nao liberado nao entra.
- A tela informa claramente o motivo quando houver falha.

---

### 2. Vinculo entre CRM e base de clientes

Status: Ideia  
Prioridade: Alta  
Data de registro: 2026-07-28  

Contexto:
Ao criar um novo cliente dentro da aba `Clientes`, esse cliente ainda nao aparece como opcao para selecionar ao criar um novo cartao no CRM.

Comportamento atual:
- Ao criar um cartao no CRM, o sistema cria automaticamente um novo cliente.
- Esse comportamento e positivo e deve ser mantido.
- Porem, tambem deve existir a opcao de usar um cliente ja existente da base.

Direcionamento futuro:
- Ao criar ou editar uma oportunidade no CRM, permitir selecionar um cliente existente.
- Manter a opcao de criar cliente automaticamente quando o nome nao existir na base.
- Evitar duplicidade de clientes quando o cliente ja estiver cadastrado.
- Vincular a oportunidade do CRM ao cadastro universal do cliente.

Criterio de conclusao:
- Cliente criado na aba `Clientes` aparece como opcao no cadastro de oportunidade do CRM.
- O CRM continua permitindo criar cliente automaticamente quando necessario.
- O sistema evita ou sinaliza possivel duplicidade de cadastro.

---

### 3. Exclusao ou arquivamento de clientes

Status: Ideia  
Prioridade: Media  
Data de registro: 2026-07-28  

Contexto:
Nao existe um botao para excluir clientes na base de clientes.

Direcionamento futuro:
- Criar opcao para remover ou arquivar clientes.
- Preferir arquivamento quando houver historico, propostas, oportunidades ou projetos vinculados.
- Exigir confirmacao antes de remover ou arquivar.
- Impedir exclusao definitiva quando o cliente possuir registros importantes vinculados.

Criterio de conclusao:
- Usuario consegue arquivar ou excluir clientes conforme regra definida.
- Clientes vinculados a historico relevante nao sao apagados sem controle.
- A tela informa claramente o impacto da acao.

---

### 4. Base de especificadores e parceiros

Status: Ideia  
Prioridade: Alta  
Data de registro: 2026-07-28  

Contexto:
Criar uma base especifica para cadastro de especificadores, parceiros e profissionais que indicam ou participam das oportunidades.

Campos desejados:
- Nome completo.
- Telefone.
- E-mail.
- Data de nascimento.
- Observacoes.
- Status ativo ou inativo.

Relacionamentos desejados:
- Permitir vincular um cliente a um especificador.
- Permitir vincular uma oportunidade do CRM a um especificador.
- Permitir usar esse vinculo futuramente para relatorios comerciais, comissoes ou acompanhamento de relacionamento.

Direcionamento futuro:
- Criar aba ou area de cadastro de especificadores.
- Criar seletor de especificador dentro do cadastro de cliente.
- Criar seletor de especificador dentro do CRM, quando fizer sentido.
- Avaliar se especificadores devem ter categorias, como arquiteto, designer, parceiro, indicador ou outro.

Criterio de conclusao:
- Sistema possui uma base propria de especificadores.
- Cliente pode ser vinculado a um especificador.
- Oportunidade pode herdar ou escolher um especificador.

---

### 5. Lembretes de aniversario de especificadores

Status: Ideia  
Prioridade: Media  
Data de registro: 2026-07-28  

Contexto:
Ao cadastrar data de nascimento do especificador, o sistema deve ajudar no relacionamento comercial criando lembretes de aniversario.

Direcionamento futuro:
- Exibir aniversarios de especificadores na agenda/calendario.
- Criar alerta proximo ao aniversario.
- Permitir filtrar aniversarios por mes.
- Avaliar notificacao interna na tela inicial ou calendario.

Criterio de conclusao:
- Especificadores com data de nascimento aparecem no calendario.
- O sistema mostra lembrete antes ou no dia do aniversario.
- O lembrete nao interfere nas tarefas de projeto, mas fica visivel como acao de relacionamento.

---

### 6. Edicao completa de oportunidades no CRM

Status: Ideia  
Prioridade: Alta  
Data de registro: 2026-07-30  

Contexto:
O CRM ainda nao apresenta uma opcao completa para editar as informacoes cadastrais da oportunidade depois que o cartao foi criado.

Problemas observados:
- Nao existe fluxo claro para editar os dados da oportunidade.
- Nao existe opcao para alterar o preco diretamente na oportunidade.
- Nao existe opcao clara para apresentar, dentro da oportunidade, o preco da proposta apresentada.

Direcionamento futuro:
- Criar acao de editar oportunidade no CRM.
- Permitir alterar dados comerciais importantes sem recriar o cartao.
- Mostrar o valor previsto da oportunidade e, quando houver proposta vinculada, mostrar tambem o valor da proposta apresentada.
- Separar claramente `valor estimado da oportunidade` de `valor da proposta`.
- Registrar alteracoes relevantes no historico da oportunidade.

Criterio de conclusao:
- Usuario consegue editar uma oportunidade existente.
- Valor da oportunidade pode ser atualizado.
- Oportunidade com proposta vinculada mostra o valor da proposta apresentada.
- Historico registra alteracoes comerciais importantes.

---

### 7. Versionamento interno de propostas

Status: Ideia  
Prioridade: Alta  
Data de registro: 2026-07-30  

Contexto:
As propostas precisam suportar versoes dentro da mesma proposta comercial, evitando telas poluidas e facilitando historico.

Comportamento desejado:
- Uma proposta pode possuir versao 01, versao 02, versao 03 e assim por diante.
- As versoes ficam agrupadas dentro da mesma proposta.
- O historico de versoes fica facil de consultar.
- Cada versao pode ter valores, ambientes e condicoes diferentes.

Direcionamento futuro:
- Manter um numero principal da proposta.
- Criar versoes internas numeradas.
- Permitir duplicar uma versao existente para criar uma nova.
- Preservar versoes antigas para auditoria.
- Definir quais campos ficam no cabecalho da proposta e quais pertencem a cada versao.

Criterio de conclusao:
- Usuario consegue criar uma nova versao de uma proposta existente.
- Versoes anteriores continuam disponiveis para consulta.
- PDF pode ser gerado a partir da versao selecionada.
- A tela exibe apenas a versao ativa, com opcao de alternar entre versoes.

---

### 8. Nome amigavel para propostas

Status: Ideia  
Prioridade: Media  
Data de registro: 2026-07-30  

Contexto:
Hoje a identificacao da proposta depende principalmente do numero e da versao. Um nome amigavel facilitaria diferenciar escopos diferentes.

Exemplos:
- `Cozinha`
- `Casa completa`
- `Dormitorios`
- `Revisao pos briefing`

Direcionamento futuro:
- Adicionar campo `nome da proposta`.
- Manter numero da proposta e versao como identificadores formais.
- Usar o nome amigavel para facilitar busca, listagem e selecao.
- Permitir que cada versao tenha um nome proprio, caso faca sentido.

Criterio de conclusao:
- Usuario consegue salvar uma proposta com nome amigavel.
- Listas e seletores mostram numero, versao e nome.
- PDF pode usar o nome quando for relevante, sem substituir o numero formal.

---

### 9. Selecao de ambientes para PDF e formacao de preco

Status: Ideia  
Prioridade: Alta  
Data de registro: 2026-07-30  

Contexto:
Em alguns casos, a proposta pode conter todos os ambientes cadastrados, mas o usuario precisa gerar PDF ou validar precificacao considerando apenas parte deles.

Comportamento desejado:
- Cada ambiente da proposta deve possuir uma selecao de inclusao.
- Ambientes nao selecionados permanecem salvos, mas nao entram no PDF ou na formacao de preco da versao selecionada.
- O usuario pode alternar rapidamente quais ambientes entram no calculo.

Direcionamento futuro:
- Criar controle visual por ambiente para `incluir nesta versao/calculo`.
- Aplicar a selecao no PDF.
- Aplicar a selecao na formacao de preco.
- Deixar claro quais ambientes estao fora do calculo atual.
- Evitar apagar dados ao desmarcar um ambiente.

Criterio de conclusao:
- Usuario consegue manter ambientes cadastrados e excluir temporariamente alguns do PDF/calculo.
- Valores totais atualizam conforme os ambientes selecionados.
- Ambientes desmarcados continuam disponiveis para uso futuro.

---

### 10. Revisao do desconto global em propostas

Status: Ideia  
Prioridade: Alta  
Data de registro: 2026-07-30  

Contexto:
Foi observado que o desconto global esta sendo aplicado apenas em um item da proposta, enquanto outros itens permanecem iguais.

Impacto:
O total da proposta pode ficar incorreto e a margem de contribuicao pode ser analisada com base em um valor errado.

Direcionamento futuro:
- Revisar a regra atual de desconto global.
- Garantir que o desconto global seja aplicado sobre a base correta da proposta.
- Definir se o desconto global deve ser rateado proporcionalmente entre ambientes ou aplicado apenas no total.
- Garantir que PDF, tela de proposta e formacao de preco usem a mesma base de calculo.
- Adicionar validacao especifica para propostas com varios ambientes.

Criterio de conclusao:
- Desconto global altera corretamente o total da proposta.
- Todos os ambientes considerados refletem o desconto conforme a regra definida.
- PDF e formacao de preco exibem os mesmos valores finais.
- Teste com multiplos ambientes confirma que nenhum item fica fora do desconto.

---

## Problemas conhecidos

### Modelo

Status: Ideia  
Prioridade: Media  
Data de registro: AAAA-MM-DD  

Descricao:
Descreva aqui o problema observado.

Impacto:
Explique onde isso afeta o uso do sistema.

Direcionamento futuro:
- Item 1
- Item 2

Criterio de conclusao:
- Como saberemos que foi resolvido.

---

## Decisoes tomadas

### Modelo

Data: AAAA-MM-DD  
Decisao:
Registre aqui a decisao tomada.

Motivo:
Explique por que essa decisao foi escolhida.

Nao fazer:
- Liste aqui o que foi decidido evitar.

---

## Fila de implementacao

### Modelo

Status: Aprovado  
Prioridade: Alta  
Responsavel: A definir  

Objetivo:
Descreva o objetivo da atualizacao.

Escopo permitido:
- O que pode ser alterado.

Escopo proibido:
- O que nao deve ser alterado.

Checklist antes de iniciar:
- Fazer backup.
- Confirmar arquivo alvo.
- Confirmar ambiente: local, cPanel ou Supabase.
- Confirmar que nao ha alteracao fora do escopo.

Checklist de validacao:
- Testar login.
- Testar CRM.
- Testar propostas.
- Testar projetos.
- Gerar pacote final, se necessario.

---

## Historico de execucao

### Registro GP - melhorias de CRM, clientes e propostas

Data: 2026-07-30  
Atualizacao:
Executadas melhorias locais do Registro GP relacionadas a CRM, clientes, especificadores e propostas.

Arquivos alterados:
- outputs/gp-mirari-deploy/index.html
- outputs/gp-mirari-deploy/assets/saas-core.js
- outputs/gp-mirari-deploy/assets/saas-core.mjs
- outputs/gp-mirari-deploy/assets/saas-extension.js
- outputs/gp-mirari-deploy/assets/saas-theme.css
- outputs/gp-mirari-deploy/tests/finance.test.mjs
- outputs/gp-mirari-deploy/docs/REGISTRO-DE-ATUALIZACOES-FUTURAS.md

Validacao realizada:
- Teste financeiro `finance.test.mjs`.
- Validacao estatica `validate-release.mjs`.
- Checagem de sintaxe com `node --check` nos arquivos JS alterados.

Observacoes:
- Login com Google permanece dependente de configuracao externa no Supabase e Google Cloud.
- A validacao em navegador nao foi concluida pelo ambiente local ter recusado conexao na porta de teste durante esta execucao.

---

### Modelo

Data: AAAA-MM-DD  
Atualizacao:
Descreva o que foi feito.

Arquivos alterados:
- Caminho do arquivo

Validacao realizada:
- Teste ou conferencia feita.

Observacoes:
- Pontos de atencao para a proxima etapa.

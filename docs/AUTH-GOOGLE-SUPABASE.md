# Autenticacao: senha e Google

Esta versao mantem o login por usuario/senha no Supabase Auth e adiciona login com Google.

## Como funciona

- O Supabase confirma a identidade do usuario.
- O GP Mirari libera o acesso somente se existir um usuario ativo no cadastro interno do sistema.
- Para login com Google, cadastre o usuario interno preferencialmente com o e-mail completo usado no Google.
- Usuarios sem cadastro interno ativo recebem a mensagem: `Acesso autenticado, mas ainda nao liberado pelo ADM.`

## Configuracao no Supabase

1. Acesse Supabase > Authentication > Providers.
2. Ative o provedor Google.
3. Informe o Client ID e Client Secret criados no Google Cloud.
4. Em Authentication > URL Configuration, configure o dominio do GP Mirari como Site URL.
5. Em Redirect URLs, adicione a URL final do cPanel, por exemplo:
   - `https://gp.mirari.com.br/`
   - `https://gp.mirari.com.br/index.html`

## Configuracao no Google Cloud

1. Crie ou use um projeto Google Cloud.
2. Configure a tela de consentimento com o nome Mirari.
3. Crie um OAuth Client ID do tipo Web application.
4. Em Authorized JavaScript origins, adicione:
   - `https://gp.mirari.com.br`
5. Em Authorized redirect URIs, adicione a callback informada pelo Supabase no provedor Google.

## Como liberar um usuario Google

1. Entre como ADM.
2. Abra Administracao > Usuarios.
3. Crie ou edite o usuario.
4. Use como usuario o e-mail completo do Google, por exemplo `nome@mirari.com.br`.
5. Marque `Liberar entrada com Google`.
6. A senha inicial e opcional quando o usuario sera somente Google.
7. Marque a permissao correta e mantenha o status ativo.

## Edge Function administrativa

Para criar usuarios com senha inicial, alterar senhas ou sincronizar mudancas administrativas mais sensiveis no modo Cloud, publique ou atualize a Edge Function:

```text
supabase/functions/gp-admin-users/index.ts
```

Essa funcao salva o usuario permitido no estado compartilhado e, quando houver senha inicial, tambem cria/atualiza o usuario no Supabase Auth.

Para usuario somente Google, o GP Mirari salva diretamente a liberacao do e-mail no estado compartilhado. Nesse caso, nao e necessario criar senha artificial: o Supabase Auth cria ou reconhece o usuario durante o login OAuth, e o GP Mirari apenas valida se o e-mail esta ativo e liberado pelo ADM.

## Encerramento automatico de sessoes

Quando o ADM altera senha, permissao, status ou remove um usuario, o GP Mirari incrementa a versao de sessao desse usuario.

- Em novas tentativas de login, a nova regra vale imediatamente.
- Em navegadores ja abertos, o sistema verifica periodicamente a versao de sessao no estado compartilhado.
- Se a sessao antiga nao bater mais com a versao atual, o usuario e desconectado e precisa entrar novamente.

Essa regra vale para login por senha e para login com Google.

## Observacoes de seguranca

- A anon public key continua permitida no navegador.
- Nunca publique a service role key no cPanel.
- O Google autentica, mas a permissao continua sendo controlada pelo cadastro interno do GP Mirari.

# GP Mirari

Aplicacao web do GP Mirari, preparada para publicacao em servidor/cPanel e controle de versao pelo GitHub.

## Estrutura

```text
index.html
assets/
  saas-core.js
  saas-extension.js
  saas-theme.css
migrations/
docs/
tests/
supabase-config.js
supabase-config.example.js
```

## Publicacao

O arquivo principal do site e `index.html`.

No cPanel, a pasta publica do subdominio deve apontar para esta estrutura, mantendo `index.html` na raiz da publicacao.

## Supabase

O arquivo `supabase-config.js` contem a URL e a anon public key usadas pelo navegador.

Importante:

- `anon public key` pode ficar no frontend.
- `service_role key` nunca deve ir para GitHub, cPanel publico ou navegador.
- O banco de dados continua separado no Supabase; atualizar estes arquivos nao apaga dados.

## Validacao Local

Com Node instalado:

```bash
npm test
```

Ou execute diretamente:

```bash
node tests/finance.test.mjs
node tests/validate-release.mjs
```

## Autenticacao

Esta versao aceita login por usuario/senha via Supabase Auth e tambem login com Google, quando o provedor Google estiver configurado no Supabase.

Consulte `docs/AUTH-GOOGLE-SUPABASE.md` antes de testar o botao `Entrar com Google`.

## Fluxo Recomendado Sem GitHub

1. Atualizar a aplicacao localmente.
2. Validar testes.
3. Compactar a pasta de publicacao.
4. Enviar o ZIP pelo Gerenciador de Arquivos do cPanel.
5. Extrair no diretorio publico do subdominio, mantendo `index.html` na raiz.
6. Testar login, CRM, propostas e formacao de preco no dominio.

# Como Atualizar o GP Mirari Depois

## Quando houver uma nova melhoria

1. Codex altera a versao local.
2. Rodamos os testes.
3. Copiamos os arquivos finais para esta pasta de deploy.
4. Enviamos para o GitHub.
5. O cPanel puxa a versao nova.

## Arquivos que normalmente mudam

```text
index.html
assets/saas-core.js
assets/saas-extension.js
assets/saas-theme.css
tests/
docs/
```

## Arquivos que normalmente nao mudam

```text
supabase-config.js
migrations/ ja executadas
```

## Regra de Seguranca

Atualizar codigo nao deve apagar banco de dados.

Os dados ficam no Supabase. Os arquivos do site ficam no cPanel/GitHub.

# Roteiro de teste do MVP local

## Produtos

- Cadastre um produto com custo e preco. Confirme que a margem aparece somente para ADM.
- Edite o preco e confirme que a versao aumenta.
- Arquive o produto e confirme que ele deixa de aparecer na inclusao de itens de proposta.

## Propostas

- Crie uma proposta a partir de uma oportunidade CRM.
- Ajuste quantidade, preco, desconto, imposto, parcelas e entrada. Confirme os totais.
- Solicite aprovacao. Confirme que o rascunho nao aceita edicao enquanto estiver em aprovacao.
- Aprove como ADM, envie ao cliente e registre o aceite.
- Confirme que os dados ficam bloqueados apos o envio e que uma nova versao pode ser criada.
- Registre uma recusa e confira o historico.

## CRM e Projetos

- Tente fechar uma oportunidade sem proposta aceita. O MVP deve orientar o aceite primeiro.
- Aceite a proposta vinculada. Confirme a criacao do projeto e o registro no CRM.
- Abra a proposta novamente. O botao de criar projeto deve estar desativado, evitando duplicidade.

## Documento

- Use `Preparar PDF` em proposta enviada ou aceita.
- No dialogo do navegador, escolha salvar como PDF e confira cliente, itens, total e condicoes.

## Criterio de aprovacao do MVP

O MVP pode seguir para homologacao SaaS quando todos os fluxos acima funcionarem sem perda de dados locais ou criacao duplicada de projeto.

// Copie este arquivo para supabase-config.js na publicacao do cPanel.
// Preencha com os dados do seu projeto Supabase.
// Use apenas a anon public key aqui. Nunca use a service_role key no navegador.

window.GP_MIRARI_SUPABASE = {
  url: "https://SEU-PROJETO.supabase.co",
  anonKey: "SUA_ANON_PUBLIC_KEY",
  // Nunca habilite em producao. Sem esta flag, login local fica bloqueado.
  demoMode: false
};

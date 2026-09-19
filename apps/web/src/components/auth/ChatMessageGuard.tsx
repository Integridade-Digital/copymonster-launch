import React, { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../lib/auth';

/**
 * Componente que intercepta tentativas de enviar mensagens no chat
 * Se usuário não estiver autenticado, redireciona para /register
 * 
 * Este componente deve ser montado no nível da aplicação para interceptar
 * eventos de envio de mensagem em qualquer lugar da interface de chat
 */
export function ChatMessageGuard() {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Interceptar custom event de tentativa de envio de mensagem
    const handleMessageSendAttempt = (event: CustomEvent) => {
      if (isLoading) return;

      if (!user) {
        // Salvar localização atual para redirect após login
        const redirectParam = location.pathname !== '/' ? `?redirect=${encodeURIComponent(location.pathname)}` : '';
        
        // Prevenir ação padrão
        event.preventDefault();
        event.stopPropagation();

        // Redirecionar para registro
        navigate(`/register${redirectParam}`);
        
        // Mostrar feedback visual (opcional - pode ser um toast)
        console.log('Usuário precisa fazer login para enviar mensagens');
      }
      // Se usuário está logado, permitir envio normalmente
    };

    // Registrar listener para evento customizado
    window.addEventListener('dsh:message-send-attempt', handleMessageSendAttempt as EventListener);

    return () => {
      window.removeEventListener('dsh:message-send-attempt', handleMessageSendAttempt as EventListener);
    };
  }, [user, isLoading, navigate, location]);

  // Não renderiza nada visível
  return null;
}

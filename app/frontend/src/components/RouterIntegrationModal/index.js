import React, { useCallback, useEffect, useState } from "react";
import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  TextField,
  Typography
} from "@material-ui/core";
import { toast } from "react-toastify";

import api from "../../services/api";
import toastError from "../../errors/toastError";

export const ROUTER_SCOPES = [
  "messages:write",
  "conversations:write",
  "integration:read",
  "transcript:read"
];

export const ROUTER_EVENTS = [
  "button.clicked",
  "message.received",
  "message.reaction",
  "message.edited",
  "message.deleted",
  "chat.updated",
  "connection.updated",
  "message.sent",
  "message.failed",
  "message.status.updated",
  "handoff.paused",
  "handoff.released",
  "conversation.created",
  "conversation.updated"
];

const RouterIntegrationModal = ({ open, onClose, connections = [] }) => {
  const [queues, setQueues] = useState([]);
  const [users, setUsers] = useState([]);
  const [connectionId, setConnectionId] = useState("");
  const [automationQueueId, setAutomationQueueId] = useState("");
  const [humanQueueId, setHumanQueueId] = useState("");
  const [userId, setUserId] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const [readiness, setReadiness] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadResources = useCallback(async () => {
    try {
      const [queueResponse, userResponse] = await Promise.all([
        api.get("/queue"),
        api.get("/users/list")
      ]);
      setQueues(Array.isArray(queueResponse.data) ? queueResponse.data : []);
      setUsers(Array.isArray(userResponse.data) ? userResponse.data : []);
    } catch (error) {
      toastError(error);
    }
  }, []);

  useEffect(() => {
    if (open) loadResources();
  }, [open, loadResources]);

  const clearSecretsAndClose = () => {
    setApiKey("");
    setSigningSecret("");
    setReadiness(null);
    onClose();
  };

  const createPreset = async () => {
    setBusy(true);
    let credentialId;
    try {
      const credential = await api.post("/api/v1/credentials", {
        name: "Integração Roteador",
        scopes: ROUTER_SCOPES,
        connectionIds: [Number(connectionId)]
      });
      credentialId = credential.data.id;
      const webhook = await api.post("/api/v1/webhook-subscriptions", {
        name: "Roteador",
        url: webhookUrl,
        events: ROUTER_EVENTS,
        messageKinds: [],
        connectionIds: [Number(connectionId)],
        includeApiOrigin: true,
        enabled: true
      });
      setApiKey(credential.data.apiKey);
      setSigningSecret(webhook.data.signingSecret);
      setReadiness(null);
      toast.success(
        "Preset criado. Copie os segredos agora; eles não serão armazenados no navegador."
      );
    } catch (error) {
      if (credentialId) {
        try {
          await api.delete(`/api/v1/credentials/${credentialId}`);
        } catch (_) {
          // A falha compensatória é exibida pelo erro original e auditável no backend.
        }
      }
      toastError(error);
    } finally {
      setBusy(false);
    }
  };

  const checkReadiness = async () => {
    setBusy(true);
    try {
      const { data } = await api.get("/api/v1/integration/ready", {
        params: {
          connectionId,
          automationQueueId,
          humanQueueId
        },
        headers: { Authorization: `Bearer ${apiKey}` }
      });
      setReadiness(data);
      if (data.ready) toast.success("Integração Roteador pronta.");
      else toast.warning("A configuração ainda não está pronta.");
    } catch (error) {
      setReadiness(null);
      toastError(error);
    } finally {
      setBusy(false);
    }
  };

  const validConfiguration =
    Number(connectionId) > 0 &&
    Number(automationQueueId) > 0 &&
    Number(humanQueueId) > 0 &&
    automationQueueId !== humanQueueId &&
    /^https:\/\//i.test(webhookUrl);

  return (
    <Dialog open={open} onClose={clearSecretsAndClose} maxWidth="md" fullWidth>
      <DialogTitle>Integração Roteador</DialogTitle>
      <DialogContent dividers>
        <Typography color="textSecondary" paragraph>
          Use somente conexão e filas reais desta empresa. A credencial e o
          segredo HMAC são mantidos apenas nesta tela e exibidos uma vez.
        </Typography>
        <TextField
          select
          fullWidth
          margin="dense"
          variant="outlined"
          label="Conexão WhatsApp real"
          value={connectionId}
          onChange={event => setConnectionId(event.target.value)}
        >
          {connections.map(connection => (
            <MenuItem key={connection.id} value={connection.id}>
              {connection.name} — {connection.status}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          fullWidth
          margin="dense"
          variant="outlined"
          label="Fila de automação"
          value={automationQueueId}
          onChange={event => setAutomationQueueId(event.target.value)}
        >
          {queues.map(queue => (
            <MenuItem key={queue.id} value={String(queue.id)}>
              {queue.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          fullWidth
          margin="dense"
          variant="outlined"
          label="Fila humana"
          value={humanQueueId}
          onChange={event => setHumanQueueId(event.target.value)}
        >
          {queues.map(queue => (
            <MenuItem key={queue.id} value={String(queue.id)}>
              {queue.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          fullWidth
          margin="dense"
          variant="outlined"
          label="Atendente padrão (opcional)"
          value={userId}
          onChange={event => setUserId(event.target.value)}
        >
          <MenuItem value="">Sem atendente padrão</MenuItem>
          {users.map(user => (
            <MenuItem key={user.id} value={String(user.id)}>
              {user.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          fullWidth
          margin="dense"
          variant="outlined"
          label="URL HTTPS do webhook do Roteador"
          value={webhookUrl}
          onChange={event => setWebhookUrl(event.target.value)}
        />
        {!apiKey && (
          <Button
            color="primary"
            variant="contained"
            disabled={!validConfiguration || busy}
            onClick={createPreset}
          >
            {busy ? <CircularProgress size={20} /> : "Criar integração"}
          </Button>
        )}
        {apiKey && (
          <>
            <Typography variant="h6" style={{ marginTop: 20 }}>
              Valores para o ambiente do Roteador
            </Typography>
            <TextField
              fullWidth
              margin="dense"
              variant="outlined"
              label="DIA_CHAT_API_KEY"
              value={apiKey}
              InputProps={{ readOnly: true }}
            />
            <TextField
              fullWidth
              margin="dense"
              variant="outlined"
              label="DIA_CHAT_WEBHOOK_SECRET"
              value={signingSecret}
              InputProps={{ readOnly: true }}
            />
            <TextField
              fullWidth
              margin="dense"
              variant="outlined"
              label="DIA_CHAT_CONNECTION_ID"
              value={connectionId}
              InputProps={{ readOnly: true }}
            />
            <TextField
              fullWidth
              margin="dense"
              variant="outlined"
              label="DIA_CHAT_AUTOMATION_QUEUE_ID"
              value={automationQueueId}
              InputProps={{ readOnly: true }}
            />
            <TextField
              fullWidth
              margin="dense"
              variant="outlined"
              label="DIA_CHAT_HUMAN_QUEUE_ID"
              value={humanQueueId}
              InputProps={{ readOnly: true }}
            />
            {userId && (
              <TextField
                fullWidth
                margin="dense"
                variant="outlined"
                label="DIA_CHAT_DEFAULT_USER_ID"
                value={userId}
                InputProps={{ readOnly: true }}
              />
            )}
            <Button
              color="primary"
              variant="outlined"
              disabled={busy}
              onClick={checkReadiness}
            >
              {busy ? <CircularProgress size={20} /> : "Testar readiness"}
            </Button>
            {readiness && (
              <Typography
                style={{ marginTop: 12 }}
                color={readiness.ready ? "primary" : "error"}
              >
                ready: {String(readiness.ready)} · conexão:{" "}
                {readiness.connection?.status} · botões:{" "}
                {String(readiness.capabilities?.buttons)}
              </Typography>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={clearSecretsAndClose}>Fechar e limpar segredos</Button>
      </DialogActions>
    </Dialog>
  );
};

export default RouterIntegrationModal;

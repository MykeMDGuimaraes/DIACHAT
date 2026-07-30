import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Switch,
  TextField,
  Typography
} from "@material-ui/core";
import { DeleteOutline, Replay } from "@material-ui/icons";

import api from "../../services/api";
import toastError from "../../errors/toastError";

export const WEBHOOK_EVENTS = [
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
  "conversation.updated",
  "ticket.created",
  "ticket.updated",
  "contact.updated"
];
export const WEBHOOK_MESSAGE_KINDS = [
  "text",
  "image",
  "audio",
  "video",
  "document",
  "template"
];

const WebhookSubscriptionsModal = ({ open, onClose, connections = [] }) => {
  const [items, setItems] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [method, setMethod] = useState("POST");
  const [includeApiOrigin, setIncludeApiOrigin] = useState(false);
  const [createdSecret, setCreatedSecret] = useState("");
  const [selectedEvents, setSelectedEvents] = useState(WEBHOOK_EVENTS);
  const [selectedKinds, setSelectedKinds] = useState([]);
  const [connectionIds, setConnectionIds] = useState("");

  const load = useCallback(async () => {
    try {
      const [subscriptions, deliveryList] = await Promise.all([
        api.get("/api/v1/webhook-subscriptions"),
        api.get("/api/v1/webhook-deliveries")
      ]);
      setItems(subscriptions.data);
      setDeliveries(deliveryList.data);
    } catch (error) {
      toastError(error);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const create = async () => {
    try {
      const { data } = await api.post("/api/v1/webhook-subscriptions", {
        name,
        url,
        method,
        events: selectedEvents,
        messageKinds: selectedKinds,
        connectionIds: connectionIds
          .split(",")
          .map(value => value.trim())
          .filter(Boolean)
          .map(Number)
          .filter(Number.isInteger),
        includeApiOrigin,
        enabled: true
      });
      setCreatedSecret(data.signingSecret || "");
      setName("");
      setUrl("");
      setMethod("POST");
      setConnectionIds("");
      await load();
      toast.success("Webhook criado.");
    } catch (error) {
      toastError(error);
    }
  };

  const update = async (id, changes) => {
    try {
      const { data } = await api.put(
        `/api/v1/webhook-subscriptions/${id}`,
        changes
      );
      if (data.signingSecret) setCreatedSecret(data.signingSecret);
      await load();
    } catch (error) {
      toastError(error);
    }
  };

  const toggleSelection = (value, setter) =>
    setter(current =>
      current.includes(value)
        ? current.filter(item => item !== value)
        : [...current, value]
    );

  const remove = async id => {
    try {
      await api.delete(`/api/v1/webhook-subscriptions/${id}`);
      await load();
    } catch (error) {
      toastError(error);
    }
  };

  const retry = async id => {
    try {
      await api.post(`/api/v1/webhook-deliveries/${id}/retry`);
      await load();
    } catch (error) {
      toastError(error);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Webhooks externos</DialogTitle>
      <DialogContent dividers>
        <Typography variant="h6">Nova assinatura</Typography>
        <TextField fullWidth margin="dense" variant="outlined" label="Nome" value={name} onChange={event => setName(event.target.value)} />
        <TextField fullWidth margin="dense" variant="outlined" label="URL HTTPS" value={url} onChange={event => setUrl(event.target.value)} />
        <TextField
          select
          fullWidth
          margin="dense"
          variant="outlined"
          label="Método HTTP"
          value={method}
          onChange={event => setMethod(event.target.value)}
          helperText="Método usado na requisição enviada ao seu endpoint"
        >
          {["POST", "PUT", "PATCH"].map(option => (
            <MenuItem key={option} value={option}>{option}</MenuItem>
          ))}
        </TextField>
        <Typography color="textSecondary">Eventos</Typography>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
          {WEBHOOK_EVENTS.map(event => (
            <Chip
              key={event}
              label={event}
              color={selectedEvents.includes(event) ? "primary" : "default"}
              onClick={() => toggleSelection(event, setSelectedEvents)}
            />
          ))}
        </div>
        <Typography color="textSecondary">Tipos de mensagem (vazio recebe todos)</Typography>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
          {WEBHOOK_MESSAGE_KINDS.map(kind => (
            <Chip
              key={kind}
              label={kind}
              color={selectedKinds.includes(kind) ? "primary" : "default"}
              onClick={() => toggleSelection(kind, setSelectedKinds)}
            />
          ))}
        </div>
        <TextField
          fullWidth
          margin="dense"
          variant="outlined"
          label="IDs das conexões (separados por vírgula; vazio recebe todas)"
          value={connectionIds}
          onChange={event => setConnectionIds(event.target.value)}
          helperText={connections.map(item => `${item.id}: ${item.name}`).join(" · ")}
        />
        <FormControlLabel control={<Switch checked={includeApiOrigin} onChange={event => setIncludeApiOrigin(event.target.checked)} color="primary" />} label="Incluir eventos originados pela API pública" />
        <Button color="primary" variant="contained" onClick={create}>Criar webhook</Button>
        {createdSecret && <TextField fullWidth margin="dense" variant="outlined" label="Segredo HMAC (exibido uma única vez)" value={createdSecret} InputProps={{ readOnly: true }} />}

        <Typography variant="h6" style={{ marginTop: 24 }}>Assinaturas</Typography>
        {items.map(item => (
          <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0" }}>
            <Chip label={item.pausedAt ? "Pausado" : item.enabled ? "Ativo" : "Desativado"} color={item.pausedAt ? "secondary" : "primary"} />
            <Typography style={{ flex: 1 }}>{item.name} — {item.method || "POST"} {item.url}</Typography>
            <Button size="small" onClick={() => update(item.id, { enabled: !item.enabled })}>
              {item.enabled ? "Desativar" : "Ativar"}
            </Button>
            <Button size="small" onClick={() => update(item.id, { rotateSecret: true })}>
              Rotacionar segredo
            </Button>
            <IconButton onClick={() => remove(item.id)}><DeleteOutline /></IconButton>
          </div>
        ))}

        <Typography variant="h6" style={{ marginTop: 24 }}>Entregas recentes</Typography>
        {deliveries.slice(0, 20).map(item => (
          <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0" }}>
            <Chip size="small" label={item.status} />
            <Typography style={{ flex: 1 }}>{item.eventType} — tentativas: {item.attemptCount}</Typography>
            {item.status === "dead_letter" && <IconButton onClick={() => retry(item.id)}><Replay /></IconButton>}
          </div>
        ))}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Fechar</Button></DialogActions>
    </Dialog>
  );
};

export default WebhookSubscriptionsModal;

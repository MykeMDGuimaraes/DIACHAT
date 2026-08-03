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
import { DeleteOutline, Edit, Replay } from "@material-ui/icons";

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

export const WEBHOOK_EXCLUDE_FILTERS = [
  { value: "fromMe", label: "Mensagens enviadas pelo atendente" },
  { value: "group", label: "Mensagens de grupos" },
  { value: "apiOriginated", label: "Eventos originados pela API" }
];

const emptyForm = initialConnectionId => ({
  name: "",
  url: "",
  method: "POST",
  selectedEvents: WEBHOOK_EVENTS,
  selectedKinds: [],
  connectionIds: initialConnectionId ? [Number(initialConnectionId)] : [],
  includeApiOrigin: false,
  excludeFilters: [],
  enabled: true
});

export const webhookFormFromSubscription = subscription => ({
  name: subscription.name || "",
  url: subscription.url || "",
  method: subscription.method || "POST",
  selectedEvents: subscription.events || [],
  selectedKinds: subscription.messageKinds || [],
  connectionIds: subscription.connectionIds || [],
  includeApiOrigin: subscription.includeApiOrigin === true,
  excludeFilters: subscription.excludeFilters || [],
  enabled: subscription.enabled !== false
});

const WebhookSubscriptionsModal = ({
  open,
  onClose,
  connections = [],
  initialConnectionId = null
}) => {
  const [items, setItems] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [form, setForm] = useState(() => emptyForm(initialConnectionId));
  const [editingId, setEditingId] = useState(null);
  const [createdSecret, setCreatedSecret] = useState("");

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

  const reset = useCallback(() => {
    setEditingId(null);
    setForm(emptyForm(initialConnectionId));
    setCreatedSecret("");
  }, [initialConnectionId]);

  useEffect(() => {
    if (open) {
      reset();
      load();
    }
  }, [open, load, reset]);

  const payload = () => ({
    name: form.name,
    url: form.url,
    method: form.method,
    events: form.selectedEvents,
    messageKinds: form.selectedKinds,
    connectionIds: form.connectionIds,
    includeApiOrigin: form.includeApiOrigin,
    excludeFilters: form.excludeFilters,
    enabled: form.enabled
  });

  const create = async () => {
    try {
      const { data } = await api.post(
        "/api/v1/webhook-subscriptions",
        payload()
      );
      setCreatedSecret(data.signingSecret || "");
      setEditingId(null);
      setForm(emptyForm(initialConnectionId));
      await load();
      toast.success("Webhook criado.");
    } catch (error) {
      toastError(error);
    }
  };

  const update = async (id, changes = payload()) => {
    try {
      const { data } = await api.put(
        `/api/v1/webhook-subscriptions/${id}`,
        changes
      );
      if (data.signingSecret) setCreatedSecret(data.signingSecret);
      await load();
      toast.success("Webhook atualizado.");
    } catch (error) {
      toastError(error);
    }
  };

  const toggle = (field, value) =>
    setForm(current => ({
      ...current,
      [field]: current[field].includes(value)
        ? current[field].filter(item => item !== value)
        : [...current[field], value]
    }));

  const edit = item => {
    setEditingId(item.id);
    setForm(webhookFormFromSubscription(item));
    setCreatedSecret("");
  };

  const remove = async id => {
    try {
      await api.delete(`/api/v1/webhook-subscriptions/${id}`);
      if (editingId === id) reset();
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
      <DialogTitle>
        {editingId ? "Editar webhook" : "Nova assinatura de webhook"}
      </DialogTitle>
      <DialogContent dividers>
        <TextField fullWidth margin="dense" variant="outlined" label="Nome" value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} />
        <TextField fullWidth margin="dense" variant="outlined" label="URL HTTPS" value={form.url} onChange={event => setForm(current => ({ ...current, url: event.target.value }))} />
        <TextField select fullWidth margin="dense" variant="outlined" label="Método HTTP" value={form.method} onChange={event => setForm(current => ({ ...current, method: event.target.value }))}>
          {["POST", "PUT", "PATCH"].map(option => <MenuItem key={option} value={option}>{option}</MenuItem>)}
        </TextField>

        <Typography color="textSecondary">Conexões (vazio recebe todas)</Typography>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
          {connections.map(connection => (
            <Chip key={connection.id} label={connection.name} color={form.connectionIds.includes(Number(connection.id)) ? "primary" : "default"} onClick={() => toggle("connectionIds", Number(connection.id))} />
          ))}
        </div>

        <Typography color="textSecondary">Eventos</Typography>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
          {WEBHOOK_EVENTS.map(event => (
            <Chip key={event} label={event} color={form.selectedEvents.includes(event) ? "primary" : "default"} onClick={() => toggle("selectedEvents", event)} />
          ))}
        </div>

        <Typography color="textSecondary">Tipos de mensagem (vazio recebe todos)</Typography>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
          {WEBHOOK_MESSAGE_KINDS.map(kind => (
            <Chip key={kind} label={kind} color={form.selectedKinds.includes(kind) ? "primary" : "default"} onClick={() => toggle("selectedKinds", kind)} />
          ))}
        </div>

        <Typography color="textSecondary">Excluir dos eventos escutados</Typography>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
          {WEBHOOK_EXCLUDE_FILTERS.map(filter => (
            <Chip key={filter.value} label={filter.label} color={form.excludeFilters.includes(filter.value) ? "secondary" : "default"} onClick={() => toggle("excludeFilters", filter.value)} />
          ))}
        </div>

        <FormControlLabel control={<Switch checked={form.includeApiOrigin} onChange={event => setForm(current => ({ ...current, includeApiOrigin: event.target.checked }))} color="primary" />} label="Permitir eventos originados pela API pública" />
        <FormControlLabel control={<Switch checked={form.enabled} onChange={event => setForm(current => ({ ...current, enabled: event.target.checked }))} color="primary" />} label="Assinatura habilitada" />

        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          {editingId ? (
            <>
              <Button color="primary" variant="contained" onClick={() => update(editingId)}>Salvar</Button>
              <Button color="primary" variant="outlined" onClick={create}>Salvar como novo</Button>
              <Button onClick={reset}>Cancelar</Button>
            </>
          ) : (
            <Button color="primary" variant="contained" disabled={!form.name.trim() || !form.url.trim() || !form.selectedEvents.length} onClick={create}>Criar webhook</Button>
          )}
        </div>

        {createdSecret && <TextField fullWidth margin="dense" variant="outlined" label="Segredo HMAC (exibido uma única vez)" value={createdSecret} InputProps={{ readOnly: true }} />}

        <Typography variant="h6" style={{ marginTop: 24 }}>Assinaturas</Typography>
        {items.map(item => (
          <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0" }}>
            <Chip label={item.pausedAt ? "Pausado" : item.enabled ? "Ativo" : "Desativado"} color={item.pausedAt ? "secondary" : "primary"} />
            <Typography style={{ flex: 1 }}>{item.name} — {item.method || "POST"} {item.url}</Typography>
            <IconButton aria-label="Editar webhook" onClick={() => edit(item)}><Edit /></IconButton>
            <Button size="small" onClick={() => update(item.id, { enabled: !item.enabled })}>{item.enabled ? "Desativar" : "Ativar"}</Button>
            <Button size="small" onClick={() => update(item.id, { rotateSecret: true })}>Rotacionar segredo</Button>
            <IconButton aria-label="Excluir webhook" onClick={() => remove(item.id)}><DeleteOutline /></IconButton>
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

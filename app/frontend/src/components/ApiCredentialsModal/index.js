import React, { useCallback, useEffect, useState } from "react";
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  TextField,
  Typography
} from "@material-ui/core";
import { DeleteOutline } from "@material-ui/icons";
import { toast } from "react-toastify";

import api from "../../services/api";
import toastError from "../../errors/toastError";

const ApiCredentialsModal = ({ open, onClose, connections = [] }) => {
  const [items, setItems] = useState([]);
  const [name, setName] = useState("");
  const [connectionIds, setConnectionIds] = useState([]);
  const [createdKey, setCreatedKey] = useState("");

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/api/v1/credentials");
      setItems(data);
    } catch (error) {
      toastError(error);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const toggleConnection = id =>
    setConnectionIds(current =>
      current.includes(id)
        ? current.filter(item => item !== id)
        : [...current, id]
    );

  const create = async () => {
    try {
      const { data } = await api.post("/api/v1/credentials", {
        name,
        scopes: [
          "messages:write",
          "conversations:write",
          "integration:read",
          "transcript:read"
        ],
        connectionIds
      });
      setCreatedKey(data.apiKey);
      setName("");
      await load();
      toast.success("Credencial criada. Copie a chave agora.");
    } catch (error) {
      toastError(error);
    }
  };

  const revoke = async id => {
    try {
      await api.delete(`/api/v1/credentials/${id}`);
      await load();
    } catch (error) {
      toastError(error);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Credenciais da API pública</DialogTitle>
      <DialogContent dividers>
        <TextField
          fullWidth
          variant="outlined"
          margin="dense"
          label="Nome da integração"
          value={name}
          onChange={event => setName(event.target.value)}
        />
        <Typography color="textSecondary">Conexões autorizadas</Typography>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "8px 0 12px" }}>
          {connections.map(connection => (
            <Chip
              key={connection.id}
              label={connection.name}
              color={connectionIds.includes(connection.id) ? "primary" : "default"}
              onClick={() => toggleConnection(connection.id)}
            />
          ))}
        </div>
        <Button
          color="primary"
          variant="contained"
          disabled={!name.trim() || !connectionIds.length}
          onClick={create}
        >
          Emitir credencial
        </Button>
        {createdKey && (
          <TextField
            fullWidth
            variant="outlined"
            margin="dense"
            label="Chave (exibida uma única vez)"
            value={createdKey}
            InputProps={{ readOnly: true }}
          />
        )}

        <Typography variant="h6" style={{ marginTop: 24 }}>Credenciais emitidas</Typography>
        {items.map(item => (
          <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0" }}>
            <Chip
              label={item.revokedAt ? "Revogada" : "Ativa"}
              color={item.revokedAt ? "secondary" : "primary"}
            />
            <Typography style={{ flex: 1 }}>
              {item.name} · conexões: {(item.connectionIds || []).join(", ")}
            </Typography>
            {!item.revokedAt && (
              <IconButton onClick={() => revoke(item.id)}>
                <DeleteOutline />
              </IconButton>
            )}
          </div>
        ))}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Fechar</Button></DialogActions>
    </Dialog>
  );
};

export default ApiCredentialsModal;

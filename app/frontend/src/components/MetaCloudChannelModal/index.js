import React, { useEffect, useState } from "react";
import { CopyToClipboard } from "react-copy-to-clipboard";
import { toast } from "react-toastify";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  TextField,
  Typography
} from "@material-ui/core";

import api from "../../services/api";
import toastError from "../../errors/toastError";

const emptyForm = {
  name: "",
  appId: "",
  appSecret: "",
  accessToken: "",
  wabaId: "",
  phoneNumberId: "",
  graphVersion: "v23.0"
};

const MetaCloudChannelModal = ({ open, onClose, whatsappId }) => {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [setup, setSetup] = useState(null);

  useEffect(() => {
    if (!open) {
      setForm(emptyForm);
      setSetup(null);
    }
  }, [open]);

  const change = event =>
    setForm(current => ({ ...current, [event.target.name]: event.target.value }));

  const save = async () => {
    setSaving(true);
    try {
      if (whatsappId) {
        await api.put(`/api/v1/channels/meta-cloud/${whatsappId}/credentials`, {
          appSecret: form.appSecret,
          accessToken: form.accessToken
        });
        toast.success("Credenciais Meta rotacionadas e validadas.");
        onClose();
      } else {
        const { data } = await api.post("/api/v1/channels/meta-cloud", form);
        setSetup(data);
        toast.success("Canal Meta criado. Conclua a configuração do webhook.");
      }
    } catch (error) {
      toastError(error);
    } finally {
      setSaving(false);
    }
  };

  const revoke = async () => {
    setSaving(true);
    try {
      await api.delete(`/api/v1/channels/meta-cloud/${whatsappId}`);
      toast.success("Credenciais Meta revogadas.");
      onClose();
    } catch (error) {
      toastError(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{whatsappId ? "Gerenciar canal Meta" : "Conectar Cloud API do WhatsApp"}</DialogTitle>
      <DialogContent dividers>
        {setup ? (
          <>
            <Typography variant="h6" gutterBottom>Configure o webhook no painel Meta</Typography>
            <TextField fullWidth margin="dense" variant="outlined" label="URL de callback" value={setup.callbackUrl} InputProps={{ readOnly: true }} />
            <CopyToClipboard text={setup.callbackUrl}><Button>Copiar URL</Button></CopyToClipboard>
            <TextField fullWidth margin="dense" variant="outlined" label="Token de verificação (exibido uma única vez)" value={setup.verifyToken} InputProps={{ readOnly: true }} />
            <CopyToClipboard text={setup.verifyToken}><Button>Copiar token</Button></CopyToClipboard>
            <Typography color="textSecondary">
              Assine o campo messages no produto WhatsApp da Meta. Guarde o token agora; ele não será exibido novamente.
            </Typography>
          </>
        ) : (
          <Grid container spacing={2}>
            {!whatsappId && (
              <>
                <Grid item xs={12}><TextField required fullWidth name="name" label="Nome da caixa de entrada" value={form.name} onChange={change} variant="outlined" /></Grid>
                <Grid item xs={12} sm={6}><TextField required fullWidth name="appId" label="ID do aplicativo Meta" value={form.appId} onChange={change} variant="outlined" /></Grid>
                <Grid item xs={12} sm={6}><TextField required fullWidth name="wabaId" label="ID da conta WhatsApp Business" value={form.wabaId} onChange={change} variant="outlined" /></Grid>
                <Grid item xs={12} sm={6}><TextField required fullWidth name="phoneNumberId" label="ID do número de telefone" value={form.phoneNumberId} onChange={change} variant="outlined" /></Grid>
                <Grid item xs={12} sm={6}><TextField required fullWidth name="graphVersion" label="Versão Graph" value={form.graphVersion} onChange={change} variant="outlined" helperText="Formato fixo, por exemplo v23.0" /></Grid>
              </>
            )}
            <Grid item xs={12}><TextField required fullWidth type="password" autoComplete="new-password" name="accessToken" label="Token permanente de usuário do sistema" value={form.accessToken} onChange={change} variant="outlined" /></Grid>
            <Grid item xs={12}><TextField required fullWidth type="password" autoComplete="new-password" name="appSecret" label="Chave secreta do aplicativo" value={form.appSecret} onChange={change} variant="outlined" /></Grid>
            <Grid item xs={12}><Typography color="textSecondary">Os segredos são validados diretamente na Meta e armazenados cifrados. Não serão exibidos novamente.</Typography></Grid>
          </Grid>
        )}
      </DialogContent>
      <DialogActions>
        {whatsappId && !setup && <Button color="secondary" onClick={revoke} disabled={saving}>Revogar canal</Button>}
        <Button onClick={onClose}>Fechar</Button>
        {!setup && <Button color="primary" variant="contained" onClick={save} disabled={saving}>{whatsappId ? "Rotacionar e validar" : "Validar e criar canal"}</Button>}
      </DialogActions>
    </Dialog>
  );
};

export default MetaCloudChannelModal;

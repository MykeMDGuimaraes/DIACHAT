import React from "react";
import {
  Card,
  CardActionArea,
  CardContent,
  Dialog,
  DialogContent,
  DialogTitle,
  Grid,
  Typography
} from "@material-ui/core";

const ChannelProviderModal = ({ open, onClose, onSelect }) => (
  <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
    <DialogTitle>Selecione seu provedor de WhatsApp</DialogTitle>
    <DialogContent>
      <Typography color="textSecondary" paragraph>
        Use uma sessão Baileys ou conecte a API oficial da Meta com as credenciais da sua empresa.
      </Typography>
      <Grid container spacing={2}>
        <Grid item xs={12} sm={6}>
          <Card variant="outlined">
            <CardActionArea onClick={() => onSelect("baileys")}>
              <CardContent>
                <Typography variant="h6">WhatsApp via Baileys</Typography>
                <Typography color="textSecondary">Conexão por QR Code</Typography>
              </CardContent>
            </CardActionArea>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6}>
          <Card variant="outlined">
            <CardActionArea onClick={() => onSelect("meta_cloud")}>
              <CardContent>
                <Typography variant="h6">Cloud API do WhatsApp</Typography>
                <Typography color="textSecondary">Canal oficial configurado na Meta</Typography>
              </CardContent>
            </CardActionArea>
          </Card>
        </Grid>
      </Grid>
    </DialogContent>
  </Dialog>
);

export default ChannelProviderModal;

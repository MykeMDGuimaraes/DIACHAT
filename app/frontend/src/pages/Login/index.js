import React, { useState, useContext } from "react";
import { Link as RouterLink } from "react-router-dom";

import Button from "@material-ui/core/Button";
import CssBaseline from "@material-ui/core/CssBaseline";
import TextField from "@material-ui/core/TextField";
import Link from "@material-ui/core/Link";
import Grid from "@material-ui/core/Grid"; 
import Box from "@material-ui/core/Box";
import Typography from "@material-ui/core/Typography";
import { makeStyles } from "@material-ui/core/styles";
import Container from "@material-ui/core/Container";
import { i18n } from "../../translate/i18n";
import pkg from "../../../package.json";
import { AuthContext } from "../../context/Auth/AuthContext";
import logo from "../../assets/logo.png";
import {LanguageOutlined} from "@material-ui/icons";
import {IconButton, Menu, MenuItem} from "@material-ui/core";
import LanguageControl from "../../components/LanguageControl";

const { versionSystem, nomeEmpresa } = pkg;


const Copyright = () => {
        return (
                <Typography variant="body2" color="primary" align="center">
                        {"Dia Solutions - CNPJ 52.897.218/0001-39"}
                </Typography>
        );
 };

const useStyles = makeStyles(theme => ({
        root: {
                width: "100vw",
                height: "100vh",
                //background: "linear-gradient(to right, #682EE3 , #682EE3 , #682EE3)",
                //backgroundImage: "url(https://i.imgur.com/CGby9tN.png)",
                backgroundColor: theme.palette.type === "light" ? theme.palette.primary.main : "#1C1C1C",
                backgroundRepeat: "no-repeat",
                backgroundSize: "100% 100%",
                backgroundPosition: "center",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
                position: "relative"
        },
        paper: {
                backgroundColor: theme.palette.login,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                padding: "55px 30px",
                borderRadius: "12.5px",
        },
        avatar: {
                margin: theme.spacing(1),  
                backgroundColor: theme.palette.secondary.main,
        },
        form: {
                width: "100%", // Fix IE 11 issue.
                marginTop: theme.spacing(1),
        },
        submit: {
                margin: theme.spacing(3, 0, 2),
        },
        powered: {
                color: "white"
        },
        languageControl: {
                position: "absolute",
                top: 0,
                left: 0,
                paddingLeft: 15
        },
        whatsappButton: {
                position: "fixed",
                bottom: 20,
                right: 20,
                width: 56,
                height: 56,
                borderRadius: "50%",
                backgroundColor: "#25D366",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                zIndex: 1000,
                transition: "transform 0.2s",
                "&:hover": {
                        transform: "scale(1.1)"
                }
        }
}));

const Login = () => {
        const classes = useStyles();

        const [user, setUser] = useState({ email: "", password: "" });

        // Languages
        const [anchorElLanguage, setAnchorElLanguage] = useState(null);
        const [menuLanguageOpen, setMenuLanguageOpen] = useState(false);

        const { handleLogin } = useContext(AuthContext);

        const handleChangeInput = e => {
                setUser({ ...user, [e.target.name]: e.target.value });
        };

        const handlSubmit = e => {
                e.preventDefault();
                handleLogin(user);
        };

        const handlemenuLanguage = ( event ) => {
                setAnchorElLanguage(event.currentTarget);
                setMenuLanguageOpen( true );
        }

        const handleCloseMenuLanguage = (  ) => {
                setAnchorElLanguage(null);
                setMenuLanguageOpen(false);
        }
        
        return (
                <div className={classes.root}>
                <div className={classes.languageControl}>
                        <IconButton edge="start">
                                <LanguageOutlined
                                        aria-label="account of current user"
                                        aria-controls="menu-appbar"
                                        aria-haspopup="true"
                                        onClick={handlemenuLanguage}
                                        variant="contained"
                                        style={{ color: "white",marginRight:10 }}
                                />
                        </IconButton>
                        <Menu
                                id="menu-appbar-language"
                                anchorEl={anchorElLanguage}
                                getContentAnchorEl={null}
                                anchorOrigin={{
                                        vertical: "bottom",
                                        horizontal: "right",
                                }}
                                transformOrigin={{
                                        vertical: "top",
                                        horizontal: "right",
                                }}
                                open={menuLanguageOpen}
                                onClose={handleCloseMenuLanguage}
                        >
                                <MenuItem>
                                        <LanguageControl />
                                </MenuItem>
                        </Menu>
                </div>
                <Container component="main" maxWidth="xs">
                        <CssBaseline/>
                        <div className={classes.paper}>
                                <div>
                                        <img style={{ margin: "0 auto", width: "70%" }} src={logo} alt="Whats" />
                                </div>
                                {/*<Typography component="h1" variant="h5">
                                        {i18n.t("login.title")}
                                </Typography>*/}
                                <form className={classes.form} noValidate onSubmit={handlSubmit}>
                                        <TextField
                                                variant="outlined"
                                                margin="normal"
                                                required
                                                fullWidth
                                                id="email"
                                                label={i18n.t("login.form.email")}
                                                name="email"
                                                value={user.email}
                                                onChange={handleChangeInput}
                                                autoComplete="email"
                                                autoFocus
                                        />
                                        <TextField
                                                variant="outlined"
                                                margin="normal"
                                                required
                                                fullWidth
                                                name="password"
                                                label={i18n.t("login.form.password")}
                                                type="password"
                                                id="password"
                                                value={user.password}
                                                onChange={handleChangeInput}
                                                autoComplete="current-password"
                                        />
                                        
                                        {/* <Grid container justify="flex-end">
                                          <Grid item xs={6} style={{ textAlign: "right" }}>
                                                <Link component={RouterLink} to="/forgetpsw" variant="body2">
                                                  Esqueceu sua senha?
                                                </Link>
                                          </Grid>
                                        </Grid>*/}
                                        
                                        <Button
                                                type="submit"
                                                fullWidth
                                                variant="contained"
                                                color="primary"
                                                className={classes.submit}
                                        >
                                                {i18n.t("login.buttons.submit")}
                                        </Button>
                                        { <Grid container>
                                                <Grid item>
                                                        <Link
                                                                href="#"
                                                                variant="body2"
                                                                component={RouterLink}
                                                                to="/signup"
                                                        >
                                                                {i18n.t("login.buttons.register")}
                                                        </Link>
                                                </Grid>
                                        </Grid> }
                                </form>
                        
                        </div>
                        <Box mt={8}><Copyright /></Box>
                </Container>
                <a
                        href="https://wa.me/553188508658"
                        target="_blank"
                        rel="noopener noreferrer"
                        className={classes.whatsappButton}
                        title="Fale conosco no WhatsApp"
                        aria-label="Fale conosco no WhatsApp"
                >
                        <svg viewBox="0 0 32 32" width="30" height="30" fill="#FFF" aria-hidden="true">
                                <path d="M16.004 3.2c-7.06 0-12.8 5.74-12.8 12.8 0 2.256.59 4.462 1.712 6.406L3.2 28.8l6.56-1.686a12.74 12.74 0 0 0 6.24 1.594h.006c7.058 0 12.794-5.74 12.794-12.8 0-3.42-1.33-6.634-3.75-9.05a12.72 12.72 0 0 0-9.046-3.658zm0 23.35h-.004a10.6 10.6 0 0 1-5.404-1.48l-.388-.23-3.894 1 1.04-3.794-.254-.39a10.58 10.58 0 0 1-1.628-5.656c0-5.868 4.776-10.642 10.65-10.642 2.842 0 5.514 1.108 7.524 3.118a10.57 10.57 0 0 1 3.114 7.53c-.004 5.868-4.78 10.644-10.756 10.644zm5.838-7.97c-.32-.16-1.894-.934-2.188-1.04-.294-.108-.508-.16-.72.16-.214.32-.828 1.04-1.014 1.254-.186.214-.374.24-.694.08-.32-.16-1.352-.498-2.574-1.588-.952-.848-1.594-1.896-1.78-2.216-.186-.32-.02-.494.14-.652.144-.144.32-.374.48-.56.16-.188.214-.32.32-.534.106-.214.054-.4-.026-.56-.08-.16-.72-1.736-.986-2.376-.26-.624-.524-.54-.72-.55l-.614-.01c-.214 0-.56.08-.854.4-.294.32-1.12 1.094-1.12 2.67 0 1.574 1.146 3.096 1.306 3.31.16.214 2.256 3.444 5.466 4.83.764.33 1.36.526 1.824.674.766.244 1.464.21 2.016.128.614-.092 1.894-.774 2.16-1.522.268-.748.268-1.388.188-1.522-.08-.134-.294-.214-.614-.374z"/>
                        </svg>
                </a>
                </div>
        );
};

export default Login;

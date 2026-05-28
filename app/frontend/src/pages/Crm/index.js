import React from "react";
import { makeStyles } from "@material-ui/core/styles";
import Paper from "@material-ui/core/Paper";

import MainContainer from "../../components/MainContainer";
import MainHeader from "../../components/MainHeader";
import Title from "../../components/Title";
import Kanban from "../Kanban";

const useStyles = makeStyles((theme) => ({
  boardWrapper: {
    flex: 1,
    padding: theme.spacing(1),
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    backgroundColor:
      theme.palette.type === "light" ? "#fafafa" : theme.palette.background.default,
  },
  boardScroller: {
    flex: 1,
    overflow: "auto",
  },
}));

const Crm = () => {
  const classes = useStyles();

  return (
    <MainContainer>
      <MainHeader>
        <Title>CRM</Title>
      </MainHeader>
      <Paper className={classes.boardWrapper} variant="outlined">
        <div className={classes.boardScroller}>
          <Kanban />
        </div>
      </Paper>
    </MainContainer>
  );
};

export default Crm;

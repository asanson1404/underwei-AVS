import express from "express";
import { ethers } from "ethers";
import dotenv from "dotenv";
dotenv.config();

import {
  AuctionRewardHoleskyAddress,
  DeploymentBlockNumberHolesky,
  AuctionRewardAmoyAddress,
  AttestationCenterAddress,
  AttestationCenterAbi,
  AuctionRewardHoleskyAbi,
  AuctionRewardAmoyAbi,
} from "./ABI/constants.js";

// The URL for the RPC endpoint (the aggregator node)
const NODE_RPC = process.env.NODE_RPC;

// The signing key for performing tasks
const nodeAccount = new ethers.Wallet(process.env.PRIVATE_KEY);

const app = express();
const port = 4002;
app.use(express.json());

// Holesky RPC provider
const HoleskyRpcUrl = process.env.HOLESKY_RPC;
// Holesky provider
const HoleskyProvider = new ethers.JsonRpcProvider(HoleskyRpcUrl);

// Amoy RPC provider
const AmoyRpcUrl = process.env.AMOY_RPC;
// Amoy provider
const AmoyProvider = new ethers.JsonRpcProvider(AmoyRpcUrl);

// Create JS contract instances
const attestationCenterContract = new ethers.Contract(
  AttestationCenterAddress,
  AttestationCenterAbi,
  AmoyProvider
);

const auctionRewardHoleskyContract = new ethers.Contract(
  AuctionRewardHoleskyAddress,
  AuctionRewardHoleskyAbi,
  HoleskyProvider
);
const auctionRewardAmoyContract = new ethers.Contract(
  AuctionRewardAmoyAddress,
  AuctionRewardAmoyAbi,
  AmoyProvider
);

/**
 * Find the elected task performer for a certain block
 */
// async function electedLeader(blockNumber) {
//     // Fetch the number of operators at block `blockNumber`
//     const count = await attestationCenterContract.numOfOperators({
//         blockTag: blockNumber,
//     });
//     const selectedOperatorId = ((BigInt(blockNumber) / 20n) % count) + 1n;
//     const paymentDetails =
//         await attestationCenterContract.getOperatorPaymentDetail(
//         selectedOperatorId,
//         { blockTag: blockNumber }
//     );
//     return paymentDetails[0];
// }
async function electedLeader() {
    return "0x5c27a880ec9024F006A70B8f1fB91b82d94ef4D4"
}

console.log("Starting..............");

auctionRewardAmoyContract.on("AuctionAccepted", async (
    acceptanceId,
    auctionId,
    createdAuctionChainId,
    buyer,
    tokenForAccepting,
    amountPaying,
    acceptOfferTimestamp,
    acceptOfferBlockNumber
) => {
    console.log("acceptanceId: ", Number(acceptanceId));
    console.log("auctionId: ", Number(auctionId));
    console.log("createdAuctionChainId: ", Number(createdAuctionChainId));
    console.log("buyer: ", buyer);
    console.log("tokenForAccepting: ", tokenForAccepting);
    console.log("amountPaying: ", Number(amountPaying));
    console.log("acceptOfferTimestamp: ", Number(acceptOfferTimestamp));
    console.log("acceptOfferBlockNumber: ", Number(acceptOfferBlockNumber));

    // Every operator knows who is supposed to send a task in the next block
    const currentPerformer = await electedLeader();

    // If the current performer is the operator itself, it performs the task
    if (currentPerformer == "0x5c27a880ec9024F006A70B8f1fB91b82d94ef4D4") {
        //console.log(currentPerformer, "is performing the task");

        var txAccepted = true;

        const createdAuctionInfo = await auctionRewardHoleskyContract.getCreatedAuctionInfo(Number(auctionId));
        console.log("Created AUCTION INFO: ", createdAuctionInfo);
        
        // Verify the Auction is accepted before its expiration
        if (Number(acceptOfferTimestamp) > Number(createdAuctionInfo.expiresAt)) {
            console.log("TIMESTAMP NOT VALID")
            txAccepted = false;
        }

        // Verify the exchange price
        if ((Number(amountPaying) > Number(createdAuctionInfo.endPrice)) && (Number(amountPaying) < Number(createdAuctionInfo.startingPrice))) {
            console.log("PRICE NOT VALID")
            txAccepted = false;
        }
        
        // Verify the tokens to exchange are the same
        if (tokenForAccepting != createdAuctionInfo.tokenForPayment) {
            console.log("TOKENS NOT VALID")
            txAccepted = false
        }

        console.log("IS_TX_VALID", txAccepted);

        const proofOfTask = `${Number(acceptOfferBlockNumber)}+${Date.now()}`;
        const taskDefinitionId = 0;
        const data = {
            auctionId: Number(auctionId),
            acceptanceId: Number(acceptanceId),
            txAccepted: txAccepted,
            auctionChainId: Number(createdAuctionInfo.auctionChainID),
            acceptingOfferChainID: Number(createdAuctionInfo.acceptingOfferChainID),
            auctionCreationEOA: createdAuctionInfo.seller,
            acceptingOfferEOA: buyer
        };
        
        const message = ethers.AbiCoder.defaultAbiCoder().encode(
            ["string", "bool", "address", "uint16"],
            [proofOfTask, txAccepted, nodeAccount.address, taskDefinitionId]
        );
        const messageHash = ethers.keccak256(message);
        const sig = nodeAccount.signingKey.sign(messageHash).serialized;

        const jsonRpcBody = {
            jsonrpc: "2.0",
            method: "sendTask",
            params: [proofOfTask, data, taskDefinitionId, nodeAccount.address, sig],
        };

        // The tasks consists of signing the current timestamp. The timestamp
        // will be used as the seed for our PRNG smart contract
        // new ethers.JsonRpcProvider(NODE_RPC).send(
        //    jsonRpcBody.method,
        //    jsonRpcBody.params
        // );

        console.log("TASK SUBMITTED")

    }
});

/**
 * AVS WebAPI endpoint:
 * This endpoint is responsible for validating that a task was performed by
 * the correct performer. It receives the performer from the Othentic node
 * and checks that it's the `currentPerformer`.
 */
app.post("/task/validate", async (req, res) => {
    console.log("OPERATORS VALIDATE TAKS")
    const { proofOfTask, performer, data } = req.body;
    //const blockNumber = parseInt(proofOfTask.split("+")[0], 10); // Extract the block number from the proof of task
    const electedPerformer = await electedLeader(); // Get the elected performer for that block

    //console.log(
    //  `Validating task for block number: ${blockNumber}, Task Performer: ${performer}, Elected Performer: ${electedPerformer}`
    //);

    console.log(data);
        
    var txAccepted = true;
    var isTaskValid = false;

    if (electedPerformer == performer) {

        const createdAuctionInfo = await auctionRewardHoleskyContract.getCreatedAuctionInfo(Number(data.auctionId));
        const acceptedAuctionInfo = await auctionRewardHoleskyContract.getAcceptedAuctionInfo(Number(data.acceptanceId));

        // Verify the Auction is accepted before its expiration
        if (Number(acceptedAuctionInfo.acceptOfferTimestamp) < Number(createdAuctionInfo.expiresAt)) { txAccepted = false }

        // Verify the exchange price
        if ((Number(acceptedAuctionInfo.amountPaying) > Number(createdAuctionInfo.endPrice)) && (Number(acceptedAuctionInfo.amountPaying) < Number(createdAuctionInfo.startingPrice))) { txAccepted = false }
        
        // Verify the tokens to exchange are the same
        if (acceptedAuctionInfo.tokenForAccepting != createdAuctionInfo.tokenForPayment) { txAccepted = false }

        if (txAccepted == data.txAccepted) {
            isTaskValid = true;
        }
    }

    if (isTaskValid) {
        console.log("Task is valid");
    }
    res.status(200);
    res.json({
        data: isTaskValid,
        error: false,
        message: "Success",
    });
});

app.listen(port, () => {
  console.log(`AVS Implementation listening on localhost:${port}`);
});

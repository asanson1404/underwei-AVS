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
//const nodeAccount = new ethers.Wallet(process.env.PRIVATE_KEY);

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

// // Create JS contract instances
// const attestationCenterContract = new ethers.Contract(
//   AttestationCenterAddress,
//   AttestationCenterAbi,
//   AmoyProvider
// );

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
    //const currentPerformer = await electedLeader(Number(acceptOfferBlockNumber));

    // If the current performer is the operator itself, it performs the task
    //if (currentPerformer == nodeAccount.address) {
        //console.log(currentPerformer, "is performing the task");

        var txAccepted = true;

        // Filter to find the ActionCreated event with the matching auctionId
        const filter = auctionRewardHoleskyContract.filters.AuctionCreated(
            Number(auctionId),
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null
        );
        
        // Find the ActionCreated event with the matching auctionId
        const createdEvent = await auctionRewardHoleskyContract.queryFilter(
            filter,
            DeploymentBlockNumberHolesky,
            Number(acceptOfferBlockNumber) - 1
        );

        console.log("CREATED EVENT: ", createdEvent);

        const createdAuctionInfo = await auctionRewardHoleskyContract.getCreatedAuctionInfo(Number(auctionId));
        
        // Verify the Auction is accepted before its expiration
        if (Number(acceptOfferTimestamp) < Number(createdAuctionInfo.expiresAt)) { txAccepted = false }

        // Verify the exchange price
        if ((Number(amountPaying) > Number(createdAuctionInfo.endPrice)) && (Number(amountPaying) < Number(createdAuctionInfo.startingPrice))) { txAccepted = false }
        
        // Verify the tokens to exchange are the same
        if (tokenForAccepting != createdAuctionInfo.tokenForPayment) { txAccepted = false }

        const proofOfTask = `${Number(blockNumber)}+${Date.now()}`;
        const taskDefinitionId = 0;
        const data = {
            auctionId: Number(auctionId),
            txAccepted: txAccepted,
            auctionChainId: Number(createdAuctionInfo.auctionChainID),
            acceptingOfferChainID: Number(createdAuctionInfo.acceptingOfferChainID),
            auctionCreationEOA: buyer,
            acceptingOfferEOA: createdAuctionInfo.seller
        };
        const dataJSON = JSON.stringify(data);
        const message = ethers.AbiCoder.defaultAbiCoder().encode(
            ["string", "bytes", "address", "uint16"],
            [proofOfTask, dataJSON, nodeAccount.address, taskDefinitionId]
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
        new ethers.JsonRpcProvider(NODE_RPC).send(
           jsonRpcBody.method,
           jsonRpcBody.params
        );

    //}
});

/**
 * AVS WebAPI endpoint:
 * This endpoint is responsible for validating that a task was performed by
 * the correct performer. It receives the performer from the Othentic node
 * and checks that it's the `currentPerformer`.
 */
// app.post("/task/validate", async (req, res) => {
//   const { proofOfTask, performer, data } = req.body;
//   const blockNumber = parseInt(proofOfTask.split("+")[0], 10); // Extract the block number from the proof of task
//   const electedPerformer = await electedLeader(blockNumber); // Get the elected performer for that block

//   console.log(
//     `Validating task for block number: ${blockNumber}, Task Performer: ${performer}, Elected Performer: ${electedPerformer}`
//   );

//   let isValid = performer === electedPerformer; // Verify the performer is the elected performer
//   if (isValid) {
//     console.log("Task is valid");
//   }
//   res.status(200);
//   res.json({
//     data: isValid,
//     error: false,
//     message: "Success",
//   });
// });

// app.listen(port, () => {
//   console.log(`AVS Implementation listening on localhost:${port}`);
// });

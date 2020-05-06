import { task, types } from "@nomiclabs/buidler/config";
import { constants, utils } from "ethers";

export default task(
  "gnosis-protocol-time-trade",
  `Creates a gelato task that sells selltoken on Batch Exchange every X seconds on Rinkeby`
)
  .addOptionalParam(
    "mnemonicIndex",
    "index of mnemonic in .env that will be used for the user address",
    "0",
    types.string
  )
  .addOptionalParam(
    "selltoken",
    "address of token to sell (default DAI)",
    "0x5592EC0cfb4dbc12D3aB100b257153436a1f0FEa",
    types.string
  )
  .addOptionalParam(
    "buytoken",
    "address of token to buy (default WETH)",
    "0xc778417e063141139fce010982780140aa0cd5ab",
    types.string
  )
  .addOptionalParam(
    "sellamount",
    "amount to sell on batch exchange (default 5*10**18)",
    "5000000000000000000",
    types.string
  )
  .addOptionalParam(
    "buyamount",
    "amount of buy token to purchase (default 0.005*10**18)",
    "5000000000000000",
    types.string
  )
  .addOptionalParam(
    "frequency",
    "how often it should be done, important for accurate approvals and expiry date",
    "5",
    types.string
  )
  .addOptionalParam(
    "seconds",
    "how many seconds between each trade - default & min is 300 (1 batch) - must be divisible by 300",
    "300",
    types.string
  )
  .addOptionalParam(
    "gelatoprovider",
    "Gelato Provider who pays ETH on gelato for the users transaction, defaults to provider of gelato core team",
    "0x518eAa8f962246bCe2FA49329Fe998B66d67cbf8",
    types.string
  )
  .addOptionalParam(
    "saltnonce",
    "CPK factory faltnonce, defaults to standard",
    "0xcfe33a586323e7325be6aa6ecd8b4600d232a9037e83c8ece69413b777dabe65",
    types.string
  )
  .addFlag("log", "Logs return values to stdout")
  .setAction(async (taskArgs) => {
    if (parseInt(taskArgs.seconds) % 300 !== 0)
      throw new Error(
        `Passed seconds must be divisible by 300 seconds (duration of one batch)`
      );

    // Batch Exchange Batch duration after which which the funds will be automatically withdrawn (e.g. 1 after one batch
    const batchDuration = ethers.utils
      .bigNumberify(taskArgs.seconds)
      .div(ethers.utils.bigNumberify("300"));

    // 1. Determine CPK proxy address of user (mnemoric index 0 by default)
    const user = config.networks.rinkeby.user();

    const userAddress = await user.getAddress();

    const safeAddress = await run("determineCpkProxyAddress", {
      useraddress: userAddress,
      saltnonce: taskArgs.saltnonce,
    });

    if (taskArgs.log) console.log(`Safe Address: ${safeAddress}`);

    // 2. Approve proxy address to move X amount of DAI

    const selltoken = await run("instantiateContract", {
      address: taskArgs.selltoken,
      name: "ERC20",
      write: true,
      signer: user,
    });

    // Check if user has sufficient balance (sell Amount plus required Fee)
    const sellTokenBalance = await selltoken.balanceOf(userAddress);

    if (sellTokenBalance.lte(ethers.utils.bigNumberify(taskArgs.sellamount)))
      throw new Error("Insufficient selltoken to conduct enter stableswap");

    const totalSellAmount = ethers.utils
      .bigNumberify(taskArgs.sellamount)
      .mul(ethers.utils.bigNumberify(taskArgs.frequency));

    if (taskArgs.log)
      console.log(`
          Approve gnosis safe to move ${totalSellAmount} of token: ${taskArgs.selltoken}\n`);

    await selltoken.approve(safeAddress, totalSellAmount);

    let safeDeployed = await run("is-safe-deployed", {
      safeaddress: safeAddress,
    });
    let gelatoIsWhitelisted = await run("is-gelato-whitelisted-module", {
      safeaddress: safeAddress,
    });

    const gelatoCoreAddress =
      config.networks.rinkeby.addressBook.gelato.gelatoCore;

    if (taskArgs.log)
      console.log(`Is gelato an enabled module? ${gelatoIsWhitelisted}`);

    // Get enable gelatoCore as module calldata
    const enableGelatoData = await run("abi-encode-withselector", {
      contractname: "IGnosisSafe",
      functionname: "enableModule",
      inputs: [gelatoCoreAddress],
    });

    // encode for Multi send
    const enableGelatoDataMultiSend = ethers.utils.solidityPack(
      ["uint8", "address", "uint256", "uint256", "bytes"],
      [
        0, //operation
        safeAddress, //to
        0, // value
        ethers.utils.hexDataLength(enableGelatoData), // data length
        enableGelatoData, // data
      ]
    );

    // Fetch BatchId if it was not passed
    const batchExchangeAddress =
      config.networks.rinkeby.addressBook.gnosisProtocol.batchExchange;

    const batchExchange = await run("instantiateContract", {
      name: "BatchExchange",
      address: batchExchangeAddress,
      read: true,
      signer: user,
    });

    const currentBatchId = await batchExchange.getCurrentBatchId();
    const currentBatchIdBN = ethers.utils.bigNumberify(currentBatchId);

    // Batch when we will withdraw the funds
    const withdrawBatch = currentBatchIdBN.add(
      ethers.utils.bigNumberify(batchDuration)
    );

    if (taskArgs.log)
      console.log(
        `Current Batch id: ${currentBatchId}\nAction is expected to withdraw after Batch Id: ${withdrawBatch}\n`
      );

    // Get submit task to withdraw from batchExchange on gelato calldata
    const gnosisSafeProviderModuleAddress =
      config.networks.rinkeby.addressBook.gelato.providerModuleGnosisSafeProxy;

    const gelatoProvider = new GelatoProvider({
      addr: taskArgs.gelatoprovider,
      module: gnosisSafeProviderModuleAddress,
    });

    // ############## Condition #####################

    const conditionAddress =
      config.networks.rinkeby.addressBook.gelatoConditions
        .conditionBatchExchangeFundsWithdrawable;

    const conditionData = await run("abi-encode-withselector", {
      contractname: "ConditionBatchExchangeFundsWithdrawable",
      functionname: "ok",
      inputs: [safeAddress, taskArgs.selltoken, taskArgs.buytoken],
    });

    const condition = new Condition({
      inst: conditionAddress,
      data: conditionData,
    });

    // ############## Condition END #####################

    const placeOrderBatchExchangeAddress =
      config.networks.rinkeby.addressBook.gelatoActions
        .actionPlaceOrderBatchExchange;

    const placeOrderBatchExchangeData = await run("abi-encode-withselector", {
      contractname: "ActionPlaceOrderBatchExchange",
      functionname: "action",
      inputs: [
        userAddress,
        taskArgs.selltoken,
        taskArgs.buytoken,
        taskArgs.sellamount,
        taskArgs.buyamount,
        batchDuration,
      ],
    });

    const placeOrderAction = new Action({
      addr: placeOrderBatchExchangeAddress,
      data: placeOrderBatchExchangeData,
      operation: Operation.Delegatecall,
      termsOkCheck: true,
    });

    const placeOrderTask = new Task({
      provider: gelatoProvider,
      conditions: [condition],
      actions: [placeOrderAction],
      expiryDate: constants.HashZero,
      autoSubmitNextTask: true,
    });

    // ######### Check if Provider has whitelisted TaskSpec #########
    await run("check-if-provided", {
      task: placeOrderTask,
      provider: gelatoProvider.addr,
    });

    // encode for Multi send
    const placeOrderBatchExchangeDataMultiSend = ethers.utils.solidityPack(
      ["uint8", "address", "uint256", "uint256", "bytes"],
      [
        1, //operation
        placeOrderBatchExchangeAddress, //to
        0, // value
        ethers.utils.hexDataLength(placeOrderBatchExchangeData), // data length
        placeOrderBatchExchangeData, // data
      ]
    );

    const submitTaskPayload = await run("abi-encode-withselector", {
      contractname: "GelatoCore",
      functionname: "submitTask",
      inputs: [placeOrderTask],
    });

    const submitTaskMultiSend = ethers.utils.solidityPack(
      ["uint8", "address", "uint256", "uint256", "bytes"],
      [
        Operation.Call, //operation => .Call
        gelatoCoreAddress, //to
        0, // value
        ethers.utils.hexDataLength(submitTaskPayload), // data length
        submitTaskPayload, // data
      ]
    );

    // Encode into MULTI SEND
    // Get Multisend address
    const multiSendAddress =
      config.networks.rinkeby.addressBook.gnosisSafe.multiSend;

    const multiSend = await run("instantiateContract", {
      name: "MultiSend",
      address: multiSendAddress,
      write: true,
      signer: user,
    });

    let encodedMultisendData;
    if (!gelatoIsWhitelisted) {
      encodedMultisendData = multiSend.interface.functions.multiSend.encode([
        ethers.utils.hexlify(
          ethers.utils.concat([
            enableGelatoDataMultiSend,
            placeOrderBatchExchangeDataMultiSend,
            submitTaskMultiSend,
          ])
        ),
      ]);
    } else {
      encodedMultisendData = multiSend.interface.functions.multiSend.encode([
        ethers.utils.hexlify(
          ethers.utils.concat([
            placeOrderBatchExchangeDataMultiSend,
            submitTaskMultiSend,
          ])
        ),
      ]);
    }

    // #2nd User tx
    let submitTaskTxHash;
    if (safeDeployed) {
      submitTaskTxHash = await run("exectransaction", {
        to: multiSendAddress,
        data: encodedMultisendData,
        operation: 1,
        log: true,
        gnosissafeproxyaddress: safeAddress,
      });
    } else {
      submitTaskTxHash = await run("deploy-gnosis-safe-and-exec-tx", {
        gnosissafeproxyaddress: safeAddress,
        to: multiSendAddress,
        data: encodedMultisendData,
        operation: 1,
        log: true,
        saltnonce: taskArgs.saltnonce,
        fallbackhandler: "0x40A930851BD2e590Bd5A5C981b436de25742E980", // default
        value: 0,
      });
    }

    if (taskArgs.log) console.log(submitTaskTxHash);

    // if (taskArgs.log)
    //   console.log(`\n submitTaskTx Hash: ${submitTaskTxHash}\n`);

    // // // Wait for tx to get mined
    // // const { blockHash: blockhash } = await submitTaskTx.wait();

    // // Event Emission verification
    // if (taskArgs.events) {
    //   const parsedSubmissionLog = await run("event-getparsedlog", {
    //     contractname: "GelatoCore",
    //     contractaddress: taskArgs.gelatocoreaddress,
    //     eventname: "LogTaskSubmitted",
    //     txhash: submitTaskTxHash,
    //     values: true,
    //     stringify: true,
    //   });
    //   if (parsedSubmissionLog)
    //     console.log("\n✅ LogTaskSubmitted\n", parsedSubmissionLog);
    //   else console.log("\n❌ LogTaskSubmitted not found");
    // }

    // return submitTaskTxHash;

    // 4. If proxy was deployed, only execTx, if not, createProxyAndExecTx
  });

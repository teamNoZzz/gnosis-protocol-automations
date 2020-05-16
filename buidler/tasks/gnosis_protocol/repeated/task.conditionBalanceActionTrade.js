import { task, types } from "@nomiclabs/buidler/config";
import { constants, utils } from "ethers";

export default task(
  "gnosis-protocol-balance-trade-repeated",
  `Creates a gelato task that sells selltoken on Batch Exchange every time users selltoken Balance reaches a certain threshold on Rinkeby`
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
    "amount of buy token to purchase (default 0.0001 ETH - market order)",
    "100000000000000",
    types.string
  )
  .addOptionalParam(
    "increaseamount",
    "Amount in selltoken balance increase that should trigger the order placement - default: 1*10**18",
    "1000000000000000000",
    types.string
  )
  .addOptionalParam(
    "cycle",
    "how often it should be done, important for accurate approvals and expiry date",
    "5",
    types.string
  )
  .addOptionalParam(
    "seconds",
    "how many seconds between each order placement & withdrawRequest - default & min is 300 (1 batch) - must be divisible by 300",
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

    // 1. Determine CPK proxy address of user )
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
      .mul(ethers.utils.bigNumberify(taskArgs.cycle));

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

    // ############## Condition

    const conditionAddress =
      config.networks.rinkeby.addressBook.gelatoConditions
        .conditionBalanceStateful;

    const conditionData = await run("abi-encode-withselector", {
      contractname: "ConditionBalanceStateful",
      functionname: "ok",
      inputs: [safeAddress, userAddress, taskArgs.selltoken, true],
    });

    const condition = new Condition({
      inst: conditionAddress,
      data: conditionData,
    });

    // Get Sell on batch exchange calldata
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

    // After placing order on batch exchange, update reference balance of user on stateful condition

    const setConditionData = await run("abi-encode-withselector", {
      contractname: "ConditionBalanceStateful",
      functionname: "setRefBalance",
      inputs: [taskArgs.increaseamount, taskArgs.selltoken, userAddress, true],
    });

    const setConditionBalanceAction = new Action({
      addr: conditionAddress,
      data: setConditionData,
      operation: Operation.Call,
      termsOkCheck: false,
    });

    const placeOrderTask = new Task({
      conditions: [condition],
      actions: [placeOrderAction, setConditionBalanceAction],
    });

    // ######### Check if Provider has whitelisted TaskSpec #########
    await run("check-if-provided", {
      task: placeOrderTask,
      provider: gelatoProvider.addr,
    });

    // ############################################### Encode Submit Task on Gelato Core

    const submitTaskPayload = await run("abi-encode-withselector", {
      contractname: "GelatoCore",
      functionname: "submitTaskCycle",
      inputs: [gelatoProvider, [placeOrderTask], 0, taskArgs.cycle],
    });

    const setConditionMultiSend = ethers.utils.solidityPack(
      ["uint8", "address", "uint256", "uint256", "bytes"],
      [
        Operation.Call, //operation => .Call
        conditionAddress, //to
        0, // value
        ethers.utils.hexDataLength(setConditionData), // data length
        setConditionData, // data
      ]
    );

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
            setConditionMultiSend,
            submitTaskMultiSend,
          ])
        ),
      ]);
    } else {
      encodedMultisendData = multiSend.interface.functions.multiSend.encode([
        ethers.utils.hexlify(
          ethers.utils.concat([setConditionMultiSend, submitTaskMultiSend])
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
    return submitTaskTxHash;
  });

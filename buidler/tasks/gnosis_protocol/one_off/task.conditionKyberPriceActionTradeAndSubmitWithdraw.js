import { task, types } from "@nomiclabs/buidler/config";
import { constants, utils } from "ethers";

export default task(
  "gnosis-protocol-kyberprice-trade-and-submit-withdraw",
  `Creates a gelato task that market sells selltoken on Batch Exchange if a certain price is reached on kyber, while scheduling a withdraw task that withdraws the tokens and sends them back to the users EOA after x seconds have passed`
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
    "pricedifference",
    "amount that the current price should be lower to activate action (default 0.00005*10**18)",
    "50000000000000",
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

    // 1. Determine CPK proxy address of user (mnemoric index 0 by default)
    const user = config.networks.rinkeby.user();

    const userAddress = await user.getAddress();

    const safeAddress = await run("determineCpkProxyAddress", {
      useraddress: userAddress,
      saltnonce: taskArgs.saltnonce,
    });

    if (taskArgs.log) console.log(`Safe Address: ${safeAddress}`);

    // 2. Approve proxy address to move X amount of DAI

    const sellToken = await run("instantiateContract", {
      address: taskArgs.selltoken,
      name: "ERC20",
      write: true,
      signer: user,
    });

    // Get the required fee from the providers Fee Contract
    const feeExtractorAddress =
      config.networks.rinkeby.addressBook.gelato.feeExtractor;

    const feeExtractor = await run("instantiateContract", {
      name: "FeeExtractor",
      address: feeExtractorAddress,
      read: true,
      signer: user,
    });

    const requiredFee = await feeExtractor.getFeeAmount(taskArgs.selltoken);
    if (requiredFee.eq(constants.Zero))
      throw Error(
        "Sell Token not accepted by provider, choose a different token"
      );

    // Check if user has sufficient balance (sell Amount plus required Fee)
    const sellTokenBalance = await sellToken.balanceOf(userAddress);
    const totalSellAmountMinusFee = ethers.utils
      .bigNumberify(taskArgs.sellamount)
      .sub(requiredFee);
    if (sellTokenBalance.lte(ethers.utils.bigNumberify(taskArgs.sellamount)))
      throw new Error("Insufficient sellToken to conduct enter stableswap");

    if (ethers.utils.bigNumberify(taskArgs.sellamount).lte(requiredFee))
      throw new Error("Sell Amount must be greater than fees");

    if (taskArgs.log)
      console.log(`
          Approve gnosis safe to move ${taskArgs.sellamount} of token: ${taskArgs.selltoken}\n
          Inputted Sell Volume:              ${taskArgs.sellamount}\n
          Fee for automated withdrawal:    - ${requiredFee}\n
          ------------------------------------------------------------\n
          Amount that will be sold:        = ${totalSellAmountMinusFee}
          `);

    await sellToken.approve(safeAddress, taskArgs.sellamount);

    let safeDeployed = await run("is-safe-deployed", {
      safeaddress: safeAddress,
    });
    let gelatoIsWhitelisted = await run("is-gelato-whitelisted-module", {
      safeaddress: safeAddress,
    });

    const gelatoCoreAddress =
      config.networks.rinkeby.addressBook.gelato.gelatoCore;

    const gelatoCore = await run("instantiateContract", {
      name: "GelatoCore",
      address: gelatoCoreAddress,
      read: true,
      signer: user,
    });

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

    const conditionAddress =
      config.networks.rinkeby.addressBook.gelatoConditions.conditionKyberRate;

    const kyberAddress = config.networks.rinkeby.addressBook.kyber.proxy;

    const kyberNetwork = await run("instantiateContract", {
      name: "IKyber",
      address: kyberAddress,
      read: true,
      signer: user,
    });

    let currentRate = await kyberNetwork.getExpectedRate(
      taskArgs.selltoken,
      taskArgs.buytoken,
      taskArgs.sellamount
    );

    currentRate = currentRate[0];

    // address _account, address _token, uint256 _refBalance, bool _greaterElseSmaller
    const referenceRate = ethers.utils
      .bigNumberify(currentRate)
      .sub(ethers.utils.bigNumberify(taskArgs.pricedifference));

    if (taskArgs.log)
      console.log(
        `Batch Exchange Order will be placed when price reaches: ${referenceRate}`
      );

    const conditionData = await run("abi-encode-withselector", {
      contractname: "ConditionKyberRate",
      functionname: "ok",
      inputs: [
        taskArgs.selltoken,
        taskArgs.sellamount,
        taskArgs.buytoken,
        referenceRate,
        false,
      ],
    });

    const condition = new Condition({
      inst: conditionAddress,
      data: conditionData,
    });

    // ############################################### Withdraw Action

    const withdrawActionAddress =
      config.networks.rinkeby.addressBook.gelatoActions
        .actionWithdrawBatchExchange;

    const actionWithdrawFromBatchExchangePayload = await run(
      "abi-encode-withselector",
      {
        contractname: "ActionWithdrawBatchExchange",
        functionname: "action",
        inputs: [userAddress, taskArgs.selltoken, taskArgs.buytoken],
      }
    );

    const actionWithdrawBatchExchange = new Action({
      addr: withdrawActionAddress,
      data: actionWithdrawFromBatchExchangePayload,
      operation: 1,
      value: 0,
      termsOkCheck: true,
    });

    const taskWithdrawBatchExchange = new Task({
      actions: [actionWithdrawBatchExchange],
    });

    // ######### Check if Provider has whitelisted TaskSpec #########
    await run("check-if-provided", {
      task: taskWithdrawBatchExchange,
      provider: gelatoProvider.addr,
    });

    // ############################################### Place Order

    // Get Sell on batch exchange calldata
    const actionPlaceOrderBatchExchangePayFeeAddress =
      config.networks.rinkeby.addressBook.gelatoActions
        .actionPlaceOrderBatchExchangePayFee;

    const placeOrderBatchExchangeData = await run("abi-encode-withselector", {
      contractname: "ActionPlaceOrderBatchExchangePayFee",
      functionname: "action",
      inputs: [
        userAddress,
        taskArgs.selltoken,
        taskArgs.buytoken,
        taskArgs.sellamount,
        1, //buyAmount => market order
        batchDuration,
      ],
    });

    const realPlaceOrderAction = new Action({
      addr: actionPlaceOrderBatchExchangePayFeeAddress,
      data: placeOrderBatchExchangeData,
      operation: 1,
      value: 0,
      termsOkCheck: true,
    });

    const placeOrderTask = new Task({
      conditions: [condition],
      actions: [realPlaceOrderAction],
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
      inputs: [
        gelatoProvider,
        [placeOrderTask, taskWithdrawBatchExchange],
        0,
        1,
      ],
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
          ethers.utils.concat([enableGelatoDataMultiSend, submitTaskMultiSend])
        ),
      ]);
    } else {
      encodedMultisendData = multiSend.interface.functions.multiSend.encode([
        ethers.utils.hexlify(ethers.utils.concat([submitTaskMultiSend])),
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

import { task, types } from "@nomiclabs/buidler/config";
import { constants, utils } from "ethers";

export default task(
  "place-order-with-automated-withdraw",
  `1) Deploys CPK proxy (if not deployed yet), 2) transfer sell Tokens from users EOA to gnosis safe, 3) sells sellTokens on batch exchange, 4) requests future withdraw and 5) tasks gelato to withdraw the funds later (after the withdraw request is valid) and sends them back to the users EOA`
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
    "0xc778417e063141139fce010982780140aa0cd5ab"
  )
  .addOptionalParam(
    "sellamount",
    "amount to sell on batch exchange (default 5*10**18)",
    "5000000000000000000"
  )
  .addOptionalParam(
    "buyamount",
    "amount of buy token to purchase (default 0.0001 ETH - market order)",
    "100000000000000"
  )
  .addOptionalParam(
    "seconds",
    "how many seconds between each trade - default & min is 600 (2 batches) - must be divisible by 300",
    "600",
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
    try {
      if (parseInt(taskArgs.seconds) % 300 !== 0)
        throw new Error(
          `Passed seconds must be divisible by 300 seconds (duration of one batch)`
        );

      // Batch Exchange Batch duration after which which the funds will be automatically withdrawn (e.g. 1 after one batch
      const batchDuration = ethers.utils
        .bigNumberify(taskArgs.seconds)
        .div(ethers.utils.bigNumberify("300"));

      const user = config.networks.rinkeby.user();
      const userAddress = await user.getAddress();

      const safeAddress = await run("determineCpkProxyAddress", {
        useraddress: userAddress,
        saltnonce: taskArgs.saltnonce,
      });

      if (taskArgs.log) console.log(`Safe Address: ${safeAddress}`);

      // Approve proxy address to move X amount of DAI
      const selltoken = await run("instantiateContract", {
        address: taskArgs.selltoken,
        name: "ERC20",
        write: true,
        signer: user,
      });

      // Get the required fee from the providers Fee Contract
      const feeExtractor = await run("instantiateContract", {
        address: config.networks.rinkeby.addressBook.gelato.feeExtractor,
        name: "FeeExtractor",
        read: true,
        signer: user,
      });

      const requiredFee = await feeExtractor.getFeeAmount(taskArgs.selltoken);
      if (requiredFee.eq(constants.Zero))
        throw Error(
          "Sell Token not accepted by provider as payment method for fee, choose a different token"
        );

      if (ethers.utils.bigNumberify(taskArgs.sellamount).lte(requiredFee))
        throw new Error("Sell Amount must be greater than fees");

      // Check if user has sufficient balance (sell Amount plus required Fee)
      const sellTokenBalance = await selltoken.balanceOf(userAddress);
      const totalSellAmountMinusFee = ethers.utils
        .bigNumberify(taskArgs.sellamount)
        .sub(requiredFee);

      if (sellTokenBalance.lte(ethers.utils.bigNumberify(taskArgs.sellamount)))
        throw new Error("Insufficient selltoken to conduct order placement");

      if (taskArgs.log)
        console.log(`
            Approve gnosis safe to move ${taskArgs.sellamount} of token: ${taskArgs.selltoken}\n
            Inputted Sell Volume:              ${taskArgs.sellamount}\n
            Fee for automated withdrawal:    - ${requiredFee}\n
            ------------------------------------------------------------\n
            Amount that will be sold:        = ${totalSellAmountMinusFee}
            `);

      // #1st User tx
      await selltoken.approve(safeAddress, taskArgs.sellamount);

      let safeDeployed = await run("is-safe-deployed", {
        safeaddress: safeAddress,
      });

      let gelatoIsWhitelisted = await run("is-gelato-whitelisted-module", {
        safeaddress: safeAddress,
      });
      if (taskArgs.log) console.log("Need to whitelist gelatoCore as module");

      const gelatoCoreAddress =
        config.networks.rinkeby.addressBook.gelato.gelatoCore;

      console.log(`Gelato Core: ${gelatoCoreAddress}`);

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

      // Encode enable gelatoCore for Multi send
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

      // ##### Provider Module
      // Define which gelato provider and which provider module to select
      const gnosisSafeProviderModuleAddress =
        config.networks.rinkeby.addressBook.gelato
          .providerModuleGnosisSafeProxy;

      const gelatoProvider = new GelatoProvider({
        addr: taskArgs.gelatoprovider,
        module: gnosisSafeProviderModuleAddress,
      });

      // ##### Actions
      const actionAddress =
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
        addr: actionAddress,
        data: actionWithdrawFromBatchExchangePayload,
        operation: 1,
        value: 0,
        termsOkCheck: true,
      });

      // ##### Task (no condition as we check termsOk in action)

      const withdrawTask = new Task({
        provider: gelatoProvider,
        actions: [actionWithdrawBatchExchange],
        expiryDate: constants.HashZero,
        autoSubmitNextTask: false,
      });

      // ######### Check if Provider has whitelisted TaskSpec #########
      await run("check-if-provided", {
        task: withdrawTask,
        provider: gelatoProvider.addr,
      });

      // check if userProxy canSubmit task
      const canSubmitResult = await gelatoCore.canSubmitTask(
        safeAddress,
        withdrawTask
      );
      console.log(canSubmitResult);

      const submitTaskPayload = await run("abi-encode-withselector", {
        contractname: "GelatoCore",
        functionname: "submitTask",
        inputs: [withdrawTask],
      });

      // Encode for MULTI SEND
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

      // Get Sell on batch exchange calldata
      const placeOrderBatchExchangeData = await run("abi-encode-withselector", {
        contractname: "ActionPlaceOrderBatchExchangePayFee",
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

      // encode for Multi send
      const actionPlaceOrderBatchExchangeAddress =
        config.networks.rinkeby.addressBook.gelatoActions
          .actionPlaceOrderBatchExchangePayFee;

      const placeOrderBatchExchangeDataMultiSend = ethers.utils.solidityPack(
        ["uint8", "address", "uint256", "uint256", "bytes"],
        [
          1, //operation
          actionPlaceOrderBatchExchangeAddress, //to
          0, // value
          ethers.utils.hexDataLength(placeOrderBatchExchangeData), // data length
          placeOrderBatchExchangeData, // data
        ]
      );

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
      if (gelatoIsWhitelisted === false) {
        console.log("Whitelisting gelato Core");
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
    } catch (err) {
      console.error(err);
    }
  });

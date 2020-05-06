// ES6 module imports via require
require("@babel/register");
const assert = require("assert");
const { constants, errors, utils } = require("ethers");

// ================================= CONFIG =========================================
// Process Env Variables
require("dotenv").config();
const USER_PK = process.env.USER_PK;
const INFURA_ID = process.env.INFURA_ID;
assert.ok(USER_PK, "no USER_PK in process.env");
assert.ok(INFURA_ID, "no Infura ID in process.env");

// Classes
const Action = require("./src/classes/gelato/Action").default;
const Condition = require("./src/classes/gelato/Condition").default;
const TaskSpec = require("./src/classes/gelato/TaskSpec").default;
const TaskReceipt = require("./src/classes/gelato/TaskReceipt").default;
const GelatoProvider = require("./src/classes/gelato/GelatoProvider").default;
const Task = require("./src/classes/gelato/Task").default;
// Objects
const { Operation } = require("./src/classes/gelato/Action");

// Disable ethers v4 warnings e.g. for solidity overloaded fns
errors.setLogLevel("error");

// ================================= BRE extension ==================================
extendEnvironment((bre) => {
  // Classes
  bre.Action = Action;
  bre.Condition = Condition;
  bre.TaskSpec = TaskSpec;
  bre.TaskReceipt = TaskReceipt;
  bre.GelatoProvider = GelatoProvider;
  bre.Task = Task;
  // Objects
  bre.Operation = Operation;
});

module.exports = {
  defaultNetwork: "rinkeby",
  networks: {
    rinkeby: {
      user: () => new ethers.Wallet(USER_PK, ethers.provider),
      chainId: 4,
      url: `https://rinkeby.infura.io/v3/${INFURA_ID}`,
      addressBook: {
        gelato: {
          executor: "0x99E69499973484a96639f4Fb17893BC96000b3b8",
          defaultProvider: "0x518eAa8f962246bCe2FA49329Fe998B66d67cbf8",
          gelatoCore: "0xe2F32A922dCd4A960BE4F7F7624d42cA583F8ECc",
          providerModuleGnosisSafeProxy:
            "0x49f7f32f3f82A3b2f923FFFd547075c00002Fe4b",
          feeExtractor: "0x9b625d0aC057450E67B7e3B6e17633AcF01Fe2a9",
        },
        gelatoActions: {
          actionWithdrawBatchExchange:
            "0xE52D98E9ce5eaB002860D79cD837c5d7C1258fcC",
          actionPlaceOrderBatchExchange:
            "0x97C2068714F7B5359da8cC3D05b6E6D8019b582c",
          actionPlaceOrderBatchExchangePayFee:
            "0xA66Dc4AacF4D23118ce148474d349b75a6A4E3C8",
        },
        gelatoConditions: {
          conditionBatchExchangeFundsWithdrawable:
            "0x66A11882E861B85685668fB3e72a7c6b74753352",
          conditionBalanceStateful:
            "0x0A5Cb504e4684E8F730F582AB9b9AA671115e60C",
        },
        gnosisSafe: {
          mastercopy: "0x34CfAC646f301356fAa8B21e94227e3583Fe3F5F",
          gnosisSafeProxyFactory: "0x76E2cFc1F5Fa8F6a5b3fC4c8F4788F0116861F9B",
          cpkFactory: "0x336c19296d3989e9e0c2561ef21c964068657c38",
          multiSend: "0x29CAa04Fa05A046a05C85A50e8f2af8cf9A05BaC",
        },
        kyber: {
          // rinkeby
          ETH: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
          proxy: "0xF77eC7Ed5f5B9a5aee4cfa6FFCaC6A4C315BaC76",
        },
        maker: {
          medianizer2: "0x7e8f5b24d89F8F32786d564a5bA76Eb806a74872",
        },
        gnosisProtocol: {
          batchExchange: "0xC576eA7bd102F7E476368a5E98FA455d1Ea34dE2",
        },
        uniswap: {
          uniswapFactoy: "0xf5D915570BC477f9B8D6C0E980aA81757A3AaC36",
          daiExchange: "0x77dB9C915809e7BE439D2AB21032B1b8B58F6891",
        },
        gelatoProvider: {
          default: "0x518eAa8f962246bCe2FA49329Fe998B66d67cbf8",
        },
      },
      // contracts: {

      // }
      //   filters: rinkebyConfig.filters,
    },
  },
};

// ================================= PLUGINS =========================================
usePlugin("@nomiclabs/buidler-ethers");

require("./buidler/tasks/gnosis_protocol/helpers/task.determineCpkProxyAddress");

// ================================= HELPERS =========================================
require("./buidler/tasks/helpers/task.instantiateContract");
require("./buidler/tasks/helpers/task.abi-encode-withselector.js");

// ================================= GELATO =========================================
require("./buidler/tasks/gelato/providers/task.checkifProvided");

// ================================= GNOSIS PROTOCOL =========================================
require("./buidler/tasks/gnosis_protocol/one_off/task.placeOrderWithAutomatedWithdraw");
require("./buidler/tasks/gnosis_protocol/repeated/task.conditionTimeActionTrade");
require("./buidler/tasks/gnosis_protocol/repeated/task.conditionBalanceActionTrade");

// ================================= GNOSIS SAFE =========================================
require("./buidler/tasks/gnosis_safe/task.execTransaction");
require("./buidler/tasks/gnosis_safe/task.deployGnosisSafeAndExecTx");
require("./buidler/tasks/gnosis_safe/task.isGelatoWhitelisted");
require("./buidler/tasks/gnosis_safe/task.isSafeDeployed");

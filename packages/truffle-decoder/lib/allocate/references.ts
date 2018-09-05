import { EvmVariableReferenceMapping, AstReferences, ContractMapping, getContractNode } from "../interface/contract-decoder";
import { ContractObject } from "truffle-contract-schema/spec";
import { StoragePointer } from "../types/pointer";
import merge from "lodash.merge";
import cloneDeep from "lodash.clonedeep";
import { Allocation, Definition } from "../utils";
import BN from "bn.js";

interface SlotAllocation {
  offset: BN;
  index: number;
};

interface ContractStateInfo {
  variables: EvmVariableReferenceMapping;
  slot: SlotAllocation;
}

export function getReferenceDeclarations(contracts: ContractObject[]): AstReferences {
  let result: AstReferences = {};
  const ReferenceDeclarationTypes = [
    "EnumDefinition",
    "StructDefinition"
  ];

  for (let i = 0; i < contracts.length; i++) {
    const contract = contracts[i];
    const contractNode = getContractNode(contract);
    if (contractNode) {
      for (let k = 0; k < contractNode.nodes.length; k++) {
        const node = contractNode.nodes[k];
        if (ReferenceDeclarationTypes.indexOf(node.nodeType) >= 0) {
          result[node.id] = node;
        }
      }
    }
  }

  return result;
}

function allocateDefinition(node: any, state: ContractStateInfo, referenceDeclarations: AstReferences, path?: Allocation.Slot): void {
  let slot: Allocation.Slot = {
    offset: state.slot.offset.clone()
  };

  if (typeof path !== "undefined") {
    slot.path = cloneDeep(path);
  }

  if (Definition.typeClass(node) != "struct") {
    const range = Allocation.allocateValue(slot, state.slot.index, Definition.storageSize(node));

    state.variables[node.id].definition = node;
    state.variables[node.id].pointer = <StoragePointer>{
      storage: cloneDeep(range)
    };

    state.slot.offset = range.next.slot.offset.clone();
    state.slot.index = range.next.index;
  }
  else {
    const structDefinition = referenceDeclarations[node.typeName.referencedDeclaration]; // ast node of StructDefinition
    for (let l = 0; l < structDefinition.members.length; l++) {
      const memberNode = structDefinition.members[l];
      state.variables[node.id].definition = node;
      allocateDefinition(memberNode, state, referenceDeclarations, slot);
    }
  }
}

function getStateVariables(contract: ContractObject, initialSlotInfo: SlotAllocation, referenceDeclarations: AstReferences): ContractStateInfo {
  let state = <ContractStateInfo>{
    variables: {},
    slot: {
      offset: initialSlotInfo.offset,
      index: initialSlotInfo.index
    }
  }

  // process for state variables
  const contractNode = getContractNode(contract);
  for (let k = 0; k < contractNode.nodes.length; k++) {
    const node = contractNode.nodes[k];

    if (node.nodeType === "VariableDeclaration" && node.stateVariable === true) {
      allocateDefinition(node, state, referenceDeclarations);
    }
  }

  return state;
}

export function getContractStateVariables(contract: ContractObject, contracts: ContractMapping, referenceDeclarations: AstReferences): EvmVariableReferenceMapping {
  let result: EvmVariableReferenceMapping = {};

  if (typeof contract.ast === "undefined") {
    return result;
  }

  const contractNode = getContractNode(contract);

  if (contractNode) {
    // process inheritance
    let slotAllocation: SlotAllocation = {
      offset: new BN(0),
      index: 0
    };

    for (let i = contractNode.linearizedBaseContracts.length - 1; i >= 0; i--) {
      const state = getStateVariables(contracts[contractNode.linearizedBaseContracts[i]], slotAllocation, referenceDeclarations);

      slotAllocation.offset = state.slot.offset;
      slotAllocation.index = state.slot.index;
      merge(result, state.variables);
    }
  }

  return result;
}
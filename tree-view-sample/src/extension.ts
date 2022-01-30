'use strict';

import * as vscode from 'vscode';

import { DepNodeProvider, Dependency } from './nodeDependencies';
import { JsonOutlineProvider } from './jsonOutline';
import { FtpExplorer } from './ftpExplorer';
import { FileExplorer } from './fileExplorer';
import { TestViewDragAndDrop } from './testViewDragAndDrop';
import { TestView } from './testView';

export function activate(context: vscode.ExtensionContext) {
	const rootPath = (vscode.workspace.workspaceFolders && (vscode.workspace.workspaceFolders.length > 0))
		? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;

	/**
	 * 本例子演示创建 treeview 的2种方式：
	 *     1. window.registerTreeDataProvider
	 *     2. window.createTreeView
	 *
	 * 第一个例子是解析 package.json 文件，提取依赖包的内容，生成 treeview 中的对应条目
	 * 可以学习到 
	 * 	   1. TreeItem 的继承和使用
	 * 	   2. TreeDataProvider 需实现的 1 个 on事件 和 4 个 getXXX 数据提供函数
	 * 	   3. JSON.parse() 等 js、ts 基础函数的使用
	 *     4. Promise 创建 Thenable 类型返回值的用法
	 */
	const nodeDependenciesProvider = new DepNodeProvider(rootPath);
	vscode.window.registerTreeDataProvider('nodeDependencies', nodeDependenciesProvider);
	vscode.commands.registerCommand('nodeDependencies.refreshEntry', () => nodeDependenciesProvider.refresh());
	vscode.commands.registerCommand('extension.openPackageOnNpm', moduleName => vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(`https://www.npmjs.com/package/${moduleName}`)));
	vscode.commands.registerCommand('nodeDependencies.addEntry', () => vscode.window.showInformationMessage(`Successfully called add entry.`));
	vscode.commands.registerCommand('nodeDependencies.editEntry', (node: Dependency) => vscode.window.showInformationMessage(`Successfully called edit entry on ${node.label}.`));
	vscode.commands.registerCommand('nodeDependencies.deleteEntry', (node: Dependency) => vscode.window.showInformationMessage(`Successfully called delete entry on ${node.label}.`));

	/**
	 * 第二个例子演示当打开 json 文件时，立刻解析其中的元素并显示在 treeview 中
	 * 可以学习到：
	 * 		1. 通过 vscode.window.onXXX、vscode.workspace.onXXX 与 vscode 的窗口和工作区交互：是实例化 Event 继承类，而不是经验理解中的函数回调
	 * 		2. 深入理解了 getChildren 与 getTreeItem 的流程
	 */
	const jsonOutlineProvider = new JsonOutlineProvider(context);
	vscode.window.registerTreeDataProvider('jsonOutline', jsonOutlineProvider);
	// refresh 命令从 view 的标题栏中触发，没有参数
	vscode.commands.registerCommand('jsonOutline.refresh', () => jsonOutlineProvider.refresh());
	// refreshNode、renameNode 从每个 item 中触发，会被传入 offset（元素在 json 文件中的字符偏移量）
	vscode.commands.registerCommand('jsonOutline.refreshNode', offset => jsonOutlineProvider.refresh(offset));
	vscode.commands.registerCommand('jsonOutline.renameNode', offset => jsonOutlineProvider.rename(offset));
	vscode.commands.registerCommand('extension.openJsonSelection', range => jsonOutlineProvider.select(range));

	/**
	 * Samples of `window.createTreeView`
	 * 函数原型是：
	 *   export function createTreeView<T>(viewId: string, options: TreeViewOptions<T>): TreeView<T>;
	 * 下面的2个例子分别是这样用的：
	 * 1. vscode.window.createTreeView('view-id', { myTreeDataProvider })
	 * 2. vscode.window.createTreeView('view-id', { treeDataProvider: aNodeWithIdTreeDataProvider(), showCollapseAll: true }
	 * 
	 * TreeViewOptions 共 3 个元素
	 * 		treeDataProvider: TreeDataProvider<T>;
	 * 		showCollapseAll?: boolean; —— 是否默认全部展开
	 * 		canSelectMany?: boolean; —— 是否支持 treeitem 多选
	 * 
	 * context.subscriptions.push(view); —— 可选
	 * push 到 context 的这个数组中只是表示扩展 dispose 的时候会自动调 view 的 dispose
	 */

	// ftpexplorer 这个例子中可以学习 ftp 库的应用，尤其是 connect 中 promise 的使用。
	new FtpExplorer(context);

	// fileexplorer 例子中 provider 继承自 TreeDataProvider 和 FileSystemProvider，但后者没有使用。
	// 本例子在 treeview 中显示了文件夹中的内容。
	new FileExplorer(context);

	// Test View
	// 演示如何用一个函数创建 TreeDataProvider<T>
	// 演示 T 是个 {key: string} 时的用法
	new TestView(context);

	// Drag and Drop proposed API sample
	// This check is for older versions of VS Code that don't have the most up-to-date tree drag and drop API proposal.
	if (typeof vscode.TreeDataTransferItem === 'function') {
		new TestViewDragAndDrop(context);
	}
}
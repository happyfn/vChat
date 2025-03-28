#include <iostream>
#include <winsock2.h>
#include <ws2tcpip.h>
#include <map>
#include <thread>

#pragma comment(lib, "ws2_32.lib")

#define SERVER_PORT 50005
#define BUFFER_SIZE 4096

std::map<sockaddr_in, int, bool(*)(const sockaddr_in&, const sockaddr_in&)> clients(
    [](const sockaddr_in& a, const sockaddr_in& b) {
        return a.sin_addr.s_addr < b.sin_addr.s_addr;
    });

void handle_client(SOCKET serverSocket) {
    char buffer[BUFFER_SIZE];
    sockaddr_in clientAddr;
    int addrLen = sizeof(clientAddr);

    while (true) {
        int received = recvfrom(serverSocket, buffer, BUFFER_SIZE, 0, (sockaddr*)&clientAddr, &addrLen);
        if (received > 0) {
            clients[clientAddr] = 1; // 记录活跃用户

            // 转发数据给所有在线用户
            for (const auto& client : clients) {
                if (memcmp(&client.first, &clientAddr, sizeof(clientAddr)) != 0) { // 不要回传给自己
                    sendto(serverSocket, buffer, received, 0, (sockaddr*)&client.first, sizeof(client.first));
                }
            }
        }
    }
}

int main() {
    WSADATA wsaData;
    WSAStartup(MAKEWORD(2, 2), &wsaData);

    SOCKET serverSocket = socket(AF_INET, SOCK_DGRAM, 0);
    sockaddr_in serverAddr = {};
    serverAddr.sin_family = AF_INET;
    serverAddr.sin_port = htons(SERVER_PORT);
    serverAddr.sin_addr.s_addr = INADDR_ANY;

    bind(serverSocket, (sockaddr*)&serverAddr, sizeof(serverAddr));

    std::cout << "语音聊天室服务器启动，监听端口：" << SERVER_PORT << std::endl;

    std::thread clientThread(handle_client, serverSocket);
    clientThread.join();

    closesocket(serverSocket);
    WSACleanup();
    return 0;
}
